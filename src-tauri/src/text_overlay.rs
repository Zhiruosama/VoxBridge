use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextAppearance {
    background_opacity: f64,
    font_size: f64,
    line_height: f64,
    text_color: String,
}
impl Default for TextAppearance {
    fn default() -> Self {
        Self {
            background_opacity: 0.9,
            font_size: 17.0,
            line_height: 1.7,
            text_color: "#f5f5f7".into(),
        }
    }
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSnapshot {
    appearance: TextAppearance,
    version: u64,
    ui_language: String,
    result: String,
    target: String,
    busy: bool,
    error: String,
    can_translate: bool,
    watching: bool,
    automatic: bool,
    copied: bool,
    copy_error: bool,
}
#[derive(Default)]
pub struct TextOverlayState(Mutex<TextSnapshot>);
#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum TextAction {
    Translate,
    Copy { text: String },
    Focus,
    Pause,
    Start,
    Automatic { enabled: bool },
}
fn validate(snapshot: &TextSnapshot) -> Result<(), String> {
    let a = &snapshot.appearance;
    if !a.background_opacity.is_finite()
        || !(0.2..=1.0).contains(&a.background_opacity)
        || !a.font_size.is_finite()
        || !(14.0..=40.0).contains(&a.font_size)
        || !a.line_height.is_finite()
        || !(1.2..=2.2).contains(&a.line_height)
        || a.text_color.len() != 7
        || !a.text_color.starts_with('#')
        || !a.text_color.as_bytes()[1..]
            .iter()
            .all(u8::is_ascii_hexdigit)
        || snapshot.version == 0
        || snapshot.version > 9_007_199_254_740_991
        || !matches!(snapshot.ui_language.as_str(), "zh-CN" | "en" | "ru")
        || snapshot.result.chars().count() > 12000
        || snapshot.target.chars().count() > 32
        || snapshot.error.chars().count() > 400
    {
        return Err("文本浮窗状态无效。".into());
    }
    Ok(())
}
#[tauri::command]
pub fn publish_text_overlay(
    window: tauri::WebviewWindow,
    snapshot: TextSnapshot,
    state: tauri::State<'_, TextOverlayState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("此操作仅限主窗口。".into());
    }
    validate(&snapshot)?;
    let mut current = state.0.lock().map_err(|_| "文本浮窗状态不可用。")?;
    if snapshot.version <= current.version {
        return Ok(());
    }
    *current = snapshot.clone();
    drop(current);
    window
        .emit_to("text-overlay", "text-overlay-snapshot", snapshot)
        .map_err(|_| "文本浮窗同步失败。".into())
}
#[tauri::command]
pub fn read_text_overlay(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, TextOverlayState>,
) -> Result<TextSnapshot, String> {
    if !matches!(window.label(), "main" | "text-overlay") {
        return Err("此操作仅限文本窗口。".into());
    }
    state
        .0
        .lock()
        .map(|s| s.clone())
        .map_err(|_| "文本浮窗状态不可用。".into())
}
#[tauri::command]
pub async fn show_text_overlay(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("此操作仅限主窗口。".into());
    }
    crate::overlay::show_named(window.app_handle(), "text-overlay").await
}
#[tauri::command]
pub async fn hide_text_overlay(window: tauri::WebviewWindow) -> Result<(), String> {
    if !matches!(window.label(), "main" | "text-overlay") {
        return Err("此操作仅限文本窗口。".into());
    }
    let target = window
        .app_handle()
        .get_webview_window("text-overlay")
        .ok_or("文本浮窗不可用。")?;
    crate::overlay::hide_subtitle_window(target).await
}
fn validate_action(label: &str, action: &TextAction) -> Result<(), String> {
    if label != "text-overlay" {
        return Err("此操作仅限文本浮窗。".into());
    }
    if let TextAction::Copy { text } = action {
        if text.is_empty() || text.chars().count() > 12000 {
            return Err("复制内容无效。".into());
        }
    }
    Ok(())
}
#[tauri::command]
pub fn text_overlay_action(
    window: tauri::WebviewWindow,
    request: TextAction,
) -> Result<(), String> {
    validate_action(window.label(), &request)?;
    window
        .emit_to("main", "text-overlay-request", request)
        .map_err(|_| "主窗口未就绪。".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshots_and_requests_are_bounded_and_have_no_clipboard_privileges() {
        let mut s = TextSnapshot {
            version: 1,
            ui_language: "zh-CN".into(),
            ..Default::default()
        };
        assert!(validate(&s).is_ok());
        s.ui_language = "ru".into();
        assert!(validate(&s).is_ok());
        s.appearance.font_size = f64::NAN;
        assert!(validate(&s).is_err());
        s.appearance = TextAppearance::default();
        s.appearance.text_color = "#zzzzzz".into();
        assert!(validate(&s).is_err());
        s.appearance = TextAppearance::default();
        s.result = "界".repeat(12001);
        assert!(validate(&s).is_err());
        for action in [
            TextAction::Translate,
            TextAction::Pause,
            TextAction::Start,
            TextAction::Automatic { enabled: true },
            TextAction::Automatic { enabled: false },
            TextAction::Focus,
            TextAction::Copy {
                text: "译文".into(),
            },
        ] {
            assert!(validate_action("text-overlay", &action).is_ok());
            assert!(validate_action("subtitle", &action).is_err());
        }
        let c: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/text-overlay.json")).unwrap();
        assert!(c["permissions"].as_array().unwrap().iter().all(|p| !p
            .as_str()
            .unwrap()
            .contains("clipboard")
            && !p.as_str().unwrap().contains("credential")
            && !p.as_str().unwrap().contains("publish")));
    }
}
