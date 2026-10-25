//! Optional local copy of the same synthesized audio. Never opens the physical microphone.
use super::*;

pub(super) struct LocalMonitor {
    device: Option<String>,
    primary_output_id: String,
    enabled: Arc<AtomicBool>,
    output: Option<(rodio::MixerDeviceSink, Player)>,
    failed: Arc<AtomicBool>,
    blocked: bool,
}
impl LocalMonitor {
    pub fn new(
        device: Option<String>,
        enabled: Arc<AtomicBool>,
        primary_output_id: String,
    ) -> Self {
        Self {
            device,
            primary_output_id,
            enabled,
            output: None,
            failed: Arc::new(AtomicBool::new(false)),
            blocked: false,
        }
    }
    /// True exactly when a new monitor player starts. Failure never cancels the send path.
    pub fn tick(&mut self, channel: &tauri::ipc::Channel<SpeechProgress>, id: &str) -> bool {
        if !self.enabled.load(Ordering::SeqCst) {
            self.output = None;
            self.blocked = false;
            self.failed.store(false, Ordering::SeqCst);
            return false;
        }
        if self.failed.load(Ordering::SeqCst)
            || self
                .output
                .as_ref()
                .is_some_and(|(_, player)| player.len() > 6)
        {
            self.output = None;
            if !self.blocked {
                progress(channel, id, "monitorUnavailable");
            }
            self.blocked = true;
        }
        if self.output.is_some() || self.blocked {
            return false;
        }
        let Some(device) = self.device.as_ref() else {
            return false;
        };
        let output = crate::platform::resolve_output(device).and_then(|resolved| {
            let id = crate::platform::output_id(&resolved)?;
            open_distinct_monitor(&self.primary_output_id, &id, || {
                open_device_output(resolved, self.failed.clone()).map(|(stream, _)| stream)
            })
        });
        match output {
            Ok(Some(stream)) => {
                let player = Player::connect_new(stream.mixer());
                self.output = Some((stream, player));
                true
            }
            Ok(None) => {
                // The primary route is already audible here. A second independently
                // buffered stream causes doubling, comb filtering and apparent echoes.
                self.blocked = true;
                false
            }
            Err(_) => {
                self.blocked = true;
                progress(channel, id, "monitorUnavailable");
                false
            }
        }
    }
    pub fn samples(&self, samples: &[f32], rate: u32) {
        if let Some((_, player)) = &self.output {
            player.append(SamplesBuffer::new(
                std::num::NonZeroU16::new(1).unwrap(),
                std::num::NonZeroU32::new(rate).unwrap(),
                samples.to_vec(),
            ));
        }
    }
    pub fn buffered(&self, source: SamplesBuffer, offset: Duration) {
        if let Some((_, player)) = &self.output {
            player.append(source.skip_duration(offset));
        }
    }
    pub fn drained(&self) -> bool {
        self.output
            .as_ref()
            .is_none_or(|(_, player)| player.empty())
    }
}

fn open_distinct_monitor<T>(
    primary: &str,
    candidate: &str,
    open: impl FnOnce() -> Result<T, String>,
) -> Result<Option<T>, String> {
    if primary == candidate {
        Ok(None)
    } else {
        open().map(Some)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn disabled_monitor_opens_nothing_and_failure_is_nonfatal_once_per_toggle() {
        let enabled = Arc::new(AtomicBool::new(false));
        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let observed = events.clone();
        let channel = tauri::ipc::Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(body) = body {
                let value: Value = serde_json::from_str(&body).unwrap();
                observed
                    .lock()
                    .unwrap()
                    .push(value["phase"].as_str().unwrap().into());
            }
            Ok(())
        });
        let mut monitor = LocalMonitor::new(
            Some("invalid-no-output".into()),
            enabled.clone(),
            "primary-output".into(),
        );
        assert!(!monitor.tick(&channel, "request"));
        assert!(events.lock().unwrap().is_empty());
        enabled.store(true, Ordering::SeqCst);
        assert!(!monitor.tick(&channel, "request"));
        assert!(!monitor.tick(&channel, "request"));
        assert!(monitor.drained());
        assert_eq!(events.lock().unwrap().as_slice(), ["monitorUnavailable"]);
        enabled.store(false, Ordering::SeqCst);
        monitor.tick(&channel, "request");
        enabled.store(true, Ordering::SeqCst);
        monitor.tick(&channel, "request");
        assert_eq!(events.lock().unwrap().len(), 2);
    }

    #[test]
    fn resolved_same_endpoint_never_opens_a_second_stream_but_distinct_routes_do() {
        let mut opened = 0;
        assert!(
            open_distinct_monitor::<()>("endpoint-a", "endpoint-a", || panic!(
                "duplicate stream must not open"
            ))
            .unwrap()
            .is_none()
        );
        assert_eq!(
            open_distinct_monitor("endpoint-a", "endpoint-b", || {
                opened += 1;
                Ok(42)
            })
            .unwrap(),
            Some(42)
        );
        assert_eq!(opened, 1);
        assert!(
            open_distinct_monitor::<()>("endpoint-a", "endpoint-b", || Err("unavailable".into()))
                .is_err()
        );
    }

    #[test]
    #[ignore = "manual read-only endpoint resolution; never opens playback or microphone streams"]
    fn default_alias_and_explicit_endpoint_do_not_duplicate_monitor_playback() {
        let device =
            crate::platform::resolve_output(crate::platform::SYSTEM_DEFAULT_OUTPUT).unwrap();
        let id = crate::platform::output_id(&device).unwrap();
        let resolved = crate::platform::resolve_output(&id).unwrap();
        assert_eq!(crate::platform::output_id(&resolved).unwrap(), id);
        let enabled = Arc::new(AtomicBool::new(true));
        let mut monitor = LocalMonitor::new(
            Some(crate::platform::SYSTEM_DEFAULT_OUTPUT.into()),
            enabled,
            id.clone(),
        );
        let channel =
            tauri::ipc::Channel::new(|_| panic!("same-device monitoring must not emit a failure"));
        assert!(!monitor.tick(&channel, "same-output"));
        assert!(monitor.output.is_none());
        assert!(monitor.blocked);
        let name = crate::platform::list_outputs()
            .unwrap()
            .into_iter()
            .find(|device| device.id == id)
            .unwrap()
            .name;
        println!(
            "DUPLICATE_MONITOR_SUPPRESSED: system default and explicit endpoint resolve to {name}"
        );
    }
}
