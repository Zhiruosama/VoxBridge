//! Optional local copy of the same synthesized audio. Never opens the physical microphone.
use super::*;

pub(super) struct LocalMonitor {
    device: Option<String>,
    enabled: Arc<AtomicBool>,
    output: Option<(rodio::MixerDeviceSink, Player)>,
    failed: Arc<AtomicBool>,
    blocked: bool,
}
impl LocalMonitor {
    pub fn new(device: Option<String>, enabled: Arc<AtomicBool>) -> Self {
        Self {
            device,
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
        match open_output(device, self.failed.clone()) {
            Ok(stream) => {
                let player = Player::connect_new(stream.mixer());
                self.output = Some((stream, player));
                true
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
        let mut monitor = LocalMonitor::new(Some("invalid-no-output".into()), enabled.clone());
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
}
