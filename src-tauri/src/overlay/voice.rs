use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSnapshot {
    version: u64,
    phase: String,
    level: f64,
    mode: String,
    enabled: bool,
    target_language: String,
    error: String,
    draft: String,
}
impl Default for VoiceSnapshot {
    fn default() -> Self {
        Self {
            version: 0,
            phase: "idle".into(),
            level: 0.0,
            mode: "dictate".into(),
            enabled: false,
            target_language: "英语".into(),
            error: String::new(),
            draft: String::new(),
        }
    }
}
#[derive(Default)]
pub struct OverlayVoiceState(Mutex<VoiceSnapshot>);
#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum VoiceRequest {
    Start,
    Finish,
    Cancel,
    Stop,
    Discard,
    Send { text: String },
}
fn validate(state: &VoiceSnapshot) -> Result<(), String> {
    if state.version == 0
        || state.version > 9_007_199_254_740_991
        || !state.level.is_finite()
        || !(0.0..=1.0).contains(&state.level)
        || !matches!(state.mode.as_str(), "dictate" | "send")
        || !matches!(
            state.phase.as_str(),
            "idle"
                | "starting"
                | "recording"
                | "recognizing"
                | "cancelling"
                | "waitingDevice"
                | "detecting"
                | "translating"
                | "synthesizing"
                | "decoding"
                | "playing"
                | "stopping"
        )
        || state.target_language.chars().count() > 32
        || state.error.chars().count() > 400
        || state.draft.chars().count() > 6000
    {
        return Err("悬浮窗语音状态无效。".into());
    }
    Ok(())
}
fn validate_request(label: &str, request: &VoiceRequest) -> Result<(), String> {
    if label != "subtitle" {
        return Err("此操作仅限字幕窗。".into());
    }
    if let VoiceRequest::Send { text } = request {
        if text.trim().is_empty() || text.chars().count() > 2000 {
            return Err("请输入 1–2000 字的内容。".into());
        }
    }
    Ok(())
}
#[tauri::command]
pub fn publish_overlay_voice(
    window: tauri::WebviewWindow,
    state: VoiceSnapshot,
    shared: tauri::State<'_, OverlayVoiceState>,
) -> Result<(), String> {
    super::require_main(window.label())?;
    validate(&state)?;
    let mut current = shared.0.lock().map_err(|_| "悬浮窗语音状态不可用。")?;
    if state.version <= current.version {
        return Ok(());
    }
    *current = state.clone();
    drop(current);
    window
        .app_handle()
        .emit_to("subtitle", "overlay-voice-state", &state)
        .map_err(|_| "无法同步悬浮窗语音状态。".into())
}
#[tauri::command]
pub fn read_overlay_voice(
    shared: tauri::State<'_, OverlayVoiceState>,
) -> Result<VoiceSnapshot, String> {
    shared
        .0
        .lock()
        .map(|value| value.clone())
        .map_err(|_| "悬浮窗语音状态不可用。".into())
}
#[tauri::command]
pub fn overlay_voice_action(
    window: tauri::WebviewWindow,
    request: VoiceRequest,
) -> Result<(), String> {
    validate_request(window.label(), &request)?;
    window
        .app_handle()
        .emit_to("main", "overlay-voice-request", &request)
        .map_err(|_| "主窗口未就绪，请重新打开软件。".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_subtitle_can_request_voice_and_text_is_bounded() {
        assert!(validate_request("main", &VoiceRequest::Start).is_err());
        assert!(validate_request("subtitle", &VoiceRequest::Start).is_ok());
        for text in [String::new(), " ".into(), "a".repeat(2001)] {
            assert!(validate_request("subtitle", &VoiceRequest::Send { text }).is_err());
        }
        assert!(validate_request(
            "subtitle",
            &VoiceRequest::Send {
                text: "你好".into()
            }
        )
        .is_ok());
    }
    #[test]
    fn voice_state_rejects_invalid_progress_and_unbounded_content() {
        let mut state = VoiceSnapshot {
            version: 1,
            ..Default::default()
        };
        assert!(validate(&state).is_ok());
        state.level = f64::NAN;
        assert!(validate(&state).is_err());
        state.level = 0.5;
        state.phase = "unknown".into();
        assert!(validate(&state).is_err());
        state.phase = "recording".into();
        state.draft = "a".repeat(6001);
        assert!(validate(&state).is_err());
    }
}
