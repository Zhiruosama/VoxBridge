use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
use tokio_util::sync::CancellationToken;

#[cfg(target_os = "macos")]
#[path = "platform/macos_capture.rs"]
mod native;

pub(crate) mod listening;
#[cfg(all(test, target_os = "macos"))]
mod test_audio;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    pub pid: i32,
    pub bundle_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureProgress {
    session_id: String,
    phase: &'static str,
    sample_rate: u32,
    frames: u64,
    dropped_frames: u64,
    rms: f64,
}

#[derive(Default)]
struct Registry {
    active: Option<(String, CancellationToken)>,
    cancelled: VecDeque<String>,
}

#[derive(Default)]
pub struct CaptureState(Arc<Mutex<Registry>>);

struct Job {
    id: String,
    token: CancellationToken,
    registry: Arc<Mutex<Registry>>,
}

impl Drop for Job {
    fn drop(&mut self) {
        self.token.cancel();
        if let Ok(mut registry) = self.registry.lock() {
            if registry
                .active
                .as_ref()
                .is_some_and(|(id, _)| id == &self.id)
            {
                registry.active = None;
            }
        }
    }
}

impl CaptureState {
    fn begin(&self, id: &str) -> Result<Job, String> {
        if id.is_empty() || id.len() > 128 {
            return Err("采集会话标识无效。".into());
        }
        let mut registry = self.0.lock().map_err(|_| "采集状态不可用。")?;
        if let Some(index) = registry.cancelled.iter().position(|old| old == id) {
            registry.cancelled.remove(index);
            return Err("采集已停止。".into());
        }
        if registry.active.is_some() {
            return Err("已有采集任务，请先停止。".into());
        }
        let token = CancellationToken::new();
        registry.active = Some((id.into(), token.clone()));
        Ok(Job {
            id: id.into(),
            token,
            registry: self.0.clone(),
        })
    }

    fn cancel(&self, id: &str) -> Result<(), String> {
        if id.is_empty() || id.len() > 128 {
            return Err("采集会话标识无效。".into());
        }
        let mut registry = self.0.lock().map_err(|_| "采集状态不可用。")?;
        if let Some((active, token)) = &registry.active {
            if active == id {
                token.cancel();
                return Ok(());
            }
        }
        if !registry.cancelled.iter().any(|old| old == id) {
            registry.cancelled.push_back(id.into());
            if registry.cancelled.len() > 64 {
                registry.cancelled.pop_front();
            }
        }
        Ok(())
    }

    pub fn stop_all(&self) {
        if let Ok(registry) = self.0.lock() {
            if let Some((_, token)) = &registry.active {
                token.cancel();
            }
        }
    }
}

#[tauri::command]
pub async fn list_capture_sources() -> Result<Vec<CaptureSource>, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(native::sources)
            .await
            .map_err(|_| "读取音频进程失败。".to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    Err("当前系统尚未接入应用声音采集。".into())
}

#[tauri::command]
pub fn stop_capture(
    session_id: String,
    state: tauri::State<'_, CaptureState>,
) -> Result<(), String> {
    state.cancel(&session_id)
}

#[tauri::command]
pub async fn capture_diagnostic(
    source: CaptureSource,
    session_id: String,
    on_progress: tauri::ipc::Channel<CaptureProgress>,
    state: tauri::State<'_, CaptureState>,
) -> Result<(), String> {
    if source.pid <= 0 || source.pid as u32 == std::process::id() || source.bundle_id.len() > 512 {
        return Err("请选择其他应用的有效音频进程。".into());
    }
    let job = state.begin(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut event = CaptureProgress {
            session_id,
            phase: "starting",
            sample_rate: 0,
            frames: 0,
            dropped_frames: 0,
            rms: 0.0,
        };
        if on_progress.send(event.clone()).is_err() {
            return Err("采集界面已关闭。".into());
        }
        let result = run_diagnostic(&source, &job.token, &on_progress, &mut event);
        event.phase = if result.is_ok() { "stopped" } else { "failed" };
        event.rms = 0.0;
        let _ = on_progress.send(event);
        result
    })
    .await
    .map_err(|_| "采集任务异常退出。".to_string())?
}

fn run_diagnostic(
    source: &CaptureSource,
    token: &CancellationToken,
    channel: &tauri::ipc::Channel<CaptureProgress>,
    event: &mut CaptureProgress,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if token.is_cancelled() {
            return Ok(());
        }
        let (writer, mut reader, dropped) = crate::pcm::channel(48_000);
        let capture = match native::Capture::start(source, writer, token) {
            Ok(capture) => capture,
            Err(error) if error == "采集已停止。" => return Ok(()),
            Err(error) => return Err(error),
        };
        event.sample_rate = capture.sample_rate;
        event.phase = "running";
        let started = Instant::now();
        let mut last_report = Instant::now() - Duration::from_secs(1);
        let mut meter = crate::pcm::Meter::default();
        let result = loop {
            if capture.failed() {
                break Err("采集设备已断开或发生错误，请停止后重新选择。".into());
            }
            if token.is_cancelled() || started.elapsed() >= Duration::from_secs(60) {
                break Ok(());
            }
            for _ in 0..48_000 {
                match reader.pop() {
                    Ok(frame) => meter.consume(frame),
                    Err(_) => break,
                }
            }
            if last_report.elapsed() >= Duration::from_millis(250) {
                if !native::source_exists(source) {
                    break Err("目标音频进程已退出或改变，请刷新进程列表。".into());
                }
                event.frames = meter.frames;
                event.dropped_frames = dropped.load(std::sync::atomic::Ordering::Relaxed);
                event.rms = meter.rms();
                if channel.send(event.clone()).is_err() {
                    break Ok(());
                }
                last_report = Instant::now();
            }
            std::thread::sleep(Duration::from_millis(25));
        };
        drop(capture);
        result
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (source, token, channel, event);
        Err("当前系统尚未接入应用声音采集。".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn early_cancel_busy_stale_stop_and_cleanup_are_isolated() {
        let state = CaptureState::default();
        state.cancel("early").unwrap();
        assert!(state.begin("early").is_err());
        let old = state.begin("old").unwrap();
        assert!(state.begin("busy").is_err());
        state.cancel("old").unwrap();
        assert!(old.token.is_cancelled());
        drop(old);
        let next = state.begin("next").unwrap();
        state.cancel("old").unwrap();
        assert!(!next.token.is_cancelled());
        state.stop_all();
        assert!(next.token.is_cancelled());
        drop(next);
        for n in 0..100 {
            state.cancel(&format!("missing-{n}")).unwrap();
        }
        assert_eq!(state.0.lock().unwrap().cancelled.len(), 64);
        assert!(state.begin("").is_err());
        assert!(state.begin(&"x".repeat(129)).is_err());
        assert!(state.begin("new").is_ok());
    }
}
