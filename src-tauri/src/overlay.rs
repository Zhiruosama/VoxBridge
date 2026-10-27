#[cfg(target_os = "macos")]
mod panel;
mod resize;
pub mod voice;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayLine {
    segment_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    paragraph_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    revision: u32,
    r#final: bool,
    translation_state: String,
    source: String,
    translation: Option<String>,
    time: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlaySnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ui_language: Option<String>,
    #[serde(default = "default_caption_layout")]
    caption_layout: String,
    version: u64,
    session_id: Option<String>,
    phase: String,
    font_size: u32,
    background_opacity: f64,
    mode: String,
    content: String,
    text_color: String,
    #[serde(default = "default_color_mode")]
    color_mode: String,
    line_height: f64,
    lines: Vec<OverlayLine>,
}

fn default_caption_layout() -> String {
    "sentence".into()
}

fn default_color_mode() -> String {
    "workspace".into()
}
fn valid_color(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

impl Default for OverlaySnapshot {
    fn default() -> Self {
        Self {
            ui_language: None,
            caption_layout: default_caption_layout(),
            version: 0,
            session_id: None,
            phase: "idle".into(),
            font_size: 22,
            background_opacity: 0.82,
            mode: "continuous".into(),
            content: "translation".into(),
            text_color: "#ffffff".into(),
            color_mode: default_color_mode(),
            line_height: 1.65,
            lines: vec![],
        }
    }
}

#[derive(Default)]
pub struct OverlayState(Mutex<OverlaySnapshot>);

fn require_main(label: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err("此操作仅限主窗口。".into())
    }
}

fn validate(snapshot: &OverlaySnapshot) -> Result<(), String> {
    if snapshot
        .ui_language
        .as_deref()
        .is_some_and(|value| !matches!(value, "zh-CN" | "en"))
        || !matches!(snapshot.caption_layout.as_str(), "sentence" | "paragraph")
        || snapshot.version == 0
        || snapshot.version > 9_007_199_254_740_991
        || !matches!(
            snapshot.phase.as_str(),
            "idle" | "starting" | "running" | "recovering" | "stopping"
        )
        || !(14..=40).contains(&snapshot.font_size)
        || !snapshot.background_opacity.is_finite()
        || !(0.2..=1.0).contains(&snapshot.background_opacity)
        || snapshot
            .session_id
            .as_ref()
            .is_some_and(|id| id.len() > 128)
        || !matches!(snapshot.mode.as_str(), "compact" | "continuous")
        || !matches!(
            snapshot.content.as_str(),
            "translation" | "bilingual" | "source"
        )
        || !valid_color(&snapshot.text_color)
        || !matches!(snapshot.color_mode.as_str(), "workspace" | "custom")
        || !snapshot.line_height.is_finite()
        || !(1.2..=2.2).contains(&snapshot.line_height)
        || snapshot.lines.len() > if snapshot.mode == "compact" { 3 } else { 160 }
        || snapshot
            .lines
            .iter()
            .map(|line| {
                line.source.chars().count()
                    + line.translation.as_deref().unwrap_or("").chars().count()
            })
            .sum::<usize>()
            > 48000
        || {
            let mut ids = std::collections::HashSet::new();
            snapshot
                .lines
                .iter()
                .any(|line| !ids.insert(&line.segment_id))
        }
        || snapshot.lines.iter().any(|line| {
            line.color.as_ref().is_some_and(|color| !valid_color(color))
                || line
                    .paragraph_id
                    .as_ref()
                    .is_some_and(|id| id.is_empty() || id.len() > 256)
                || line.segment_id.is_empty()
                || line.segment_id.len() > 256
                || line.revision == 0
                || !matches!(
                    line.translation_state.as_str(),
                    "pending" | "ready" | "failed"
                )
                || (line.translation_state == "ready")
                    != line
                        .translation
                        .as_ref()
                        .is_some_and(|text| !text.is_empty())
                || line.source.chars().count() > 6000
                || line
                    .translation
                    .as_ref()
                    .is_some_and(|text| text.chars().count() > 6000)
                || line.time.len() > 32
        })
    {
        return Err("悬浮字幕数据超出限制。".into());
    }
    Ok(())
}

impl OverlayState {
    fn publish(
        &self,
        label: &str,
        snapshot: OverlaySnapshot,
    ) -> Result<Option<OverlaySnapshot>, String> {
        require_main(label)?;
        validate(&snapshot)?;
        let mut current = self.0.lock().map_err(|_| "悬浮字幕状态不可用。")?;
        if snapshot.version <= current.version {
            return Ok(None);
        }
        *current = snapshot.clone();
        Ok(Some(snapshot))
    }
}

#[tauri::command]
pub fn publish_overlay(
    window: tauri::WebviewWindow,
    snapshot: OverlaySnapshot,
    state: tauri::State<'_, OverlayState>,
) -> Result<(), String> {
    if let Some(snapshot) = state.publish(window.label(), snapshot)? {
        window
            .app_handle()
            .emit_to("subtitle", "overlay-snapshot", &snapshot)
            .map_err(|_| "无法同步悬浮字幕。")?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_overlay(state: tauri::State<'_, OverlayState>) -> Result<OverlaySnapshot, String> {
    state
        .0
        .lock()
        .map(|value| value.clone())
        .map_err(|_| "悬浮字幕状态不可用。".into())
}

#[tauri::command]
pub async fn show_overlay(window: tauri::WebviewWindow) -> Result<(), String> {
    require_main(window.label())?;
    show_named(window.app_handle(), "subtitle").await
}

pub(crate) async fn show_named(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let overlay = app.get_webview_window(label).ok_or("悬浮窗口不可用。")?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let subtitle = overlay.clone();
    overlay
        .run_on_main_thread(move || {
            let result = show_subtitle_window(&subtitle);
            let _ = tx.send(result);
        })
        .map_err(|_| "无法设置悬浮字幕窗。")?;
    rx.await.map_err(|_| "悬浮字幕窗已关闭。")?
}

fn show_subtitle_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        panel::show(window)
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.show().map_err(|_| "无法显示悬浮字幕窗。".into())
    }
}

pub(crate) async fn hide_subtitle_window(window: tauri::WebviewWindow) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let subtitle = window.clone();
    window
        .run_on_main_thread(move || {
            #[cfg(target_os = "macos")]
            let result = {
                panel::hide(subtitle.label());
                Ok(())
            };
            #[cfg(not(target_os = "macos"))]
            let result = subtitle
                .hide()
                .map_err(|_| "无法隐藏悬浮字幕窗。".to_string());
            let _ = subtitle;
            let _ = tx.send(result);
        })
        .map_err(|_| "无法收起悬浮字幕窗。")?;
    rx.await.map_err(|_| "悬浮字幕窗已关闭。")?
}

#[tauri::command]
pub async fn drag_overlay(
    window: tauri::WebviewWindow,
    id: String,
    phase: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    if !matches!(window.label(), "subtitle" | "text-overlay") {
        return Err("此操作仅限字幕窗。".into());
    }
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let label = window.label().to_owned();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(panel::drag(&label, id, &phase, x, y));
            })
            .map_err(|_| "无法拖动字幕窗。")?;
        rx.await.map_err(|_| "字幕窗已关闭。")?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (id, x, y);
        if phase != "begin" {
            return Ok(());
        }
        window
            .start_dragging()
            .map_err(|_| "无法拖动字幕窗。".into())
    }
}

#[tauri::command]
pub async fn resize_overlay(
    window: tauri::WebviewWindow,
    id: String,
    phase: String,
    direction: tauri_runtime::ResizeDirection,
) -> Result<(), String> {
    if !matches!(window.label(), "subtitle" | "text-overlay")
        || id.is_empty()
        || id.len() > 128
        || !matches!(phase.as_str(), "begin" | "move" | "end")
    {
        return Err("字幕缩放请求无效。".into());
    }
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let label = window.label().to_owned();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(panel::resize(&label, id, &phase, direction));
            })
            .map_err(|_| "无法调整字幕窗大小。")?;
        rx.await.map_err(|_| "字幕窗已关闭。")?
    }
    #[cfg(not(target_os = "macos"))]
    {
        if phase != "begin" {
            return Ok(());
        }
        let webview: &tauri::Webview = window.as_ref();
        webview
            .window()
            .start_resize_dragging(direction)
            .map_err(|_| "无法调整字幕窗大小。".into())
    }
}

#[cfg(target_os = "macos")]
fn subtitle_collection_behavior(
    current: objc2_app_kit::NSWindowCollectionBehavior,
) -> objc2_app_kit::NSWindowCollectionBehavior {
    use objc2_app_kit::NSWindowCollectionBehavior as Behavior;
    // AppKit requires mutually exclusive choices within both the Spaces and
    // Stage Manager groups. Preserve unrelated behavior managed by Tauri.
    (current
        & !(Behavior::MoveToActiveSpace
            | Behavior::FullScreenPrimary
            | Behavior::FullScreenNone
            | Behavior::Primary
            | Behavior::Auxiliary))
        | Behavior::CanJoinAllSpaces
        | Behavior::FullScreenAuxiliary
        | Behavior::CanJoinAllApplications
}

#[tauri::command]
pub async fn hide_overlay(window: tauri::WebviewWindow) -> Result<(), String> {
    let overlay = window
        .app_handle()
        .get_webview_window("subtitle")
        .ok_or("悬浮字幕窗不可用。")?;
    hide_subtitle_window(overlay).await
}

#[tauri::command]
pub async fn focus_main(window: tauri::WebviewWindow) -> Result<(), String> {
    let main = window
        .app_handle()
        .get_webview_window("main")
        .ok_or("主窗口不可用。")?;
    main.show()
        .and_then(|_| main.unminimize())
        .and_then(|_| main.set_focus())
        .map_err(|_| "无法返回主窗口。".to_string())?;
    if matches!(window.label(), "subtitle" | "text-overlay") {
        hide_subtitle_window(window).await?;
    }
    Ok(())
}

#[tauri::command]
pub fn stop_overlay_listening(
    window: tauri::WebviewWindow,
    capture: tauri::State<'_, crate::capture::CaptureState>,
) -> Result<(), String> {
    capture.finish_active();
    window
        .app_handle()
        .emit_to("main", "overlay-stop-request", ())
        .map_err(|_| "停止请求通知失败，请返回主窗口。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn subtitle_joins_spaces_and_fullscreen_without_conflicting_window_roles() {
        use objc2_app_kit::NSWindowCollectionBehavior as Behavior;
        let original = Behavior::MoveToActiveSpace
            | Behavior::FullScreenPrimary
            | Behavior::Primary
            | Behavior::IgnoresCycle;
        let actual = subtitle_collection_behavior(original);
        assert!(actual.contains(
            Behavior::CanJoinAllSpaces
                | Behavior::FullScreenAuxiliary
                | Behavior::CanJoinAllApplications
                | Behavior::IgnoresCycle
        ));
        assert!(!actual.intersects(
            Behavior::MoveToActiveSpace
                | Behavior::FullScreenPrimary
                | Behavior::FullScreenNone
                | Behavior::Primary
                | Behavior::Auxiliary
        ));
        assert_eq!(subtitle_collection_behavior(actual), actual);
    }

    fn snapshot(version: u64) -> OverlaySnapshot {
        OverlaySnapshot {
            version,
            ..OverlaySnapshot::default()
        }
    }

    #[test]
    fn only_main_can_publish_and_late_snapshots_cannot_restore_old_session() {
        let state = OverlayState::default();
        assert!(state.publish("subtitle", snapshot(1)).is_err());
        let mut first = snapshot(1);
        first.session_id = Some("old".into());
        first.phase = "running".into();
        assert!(state.publish("main", first).unwrap().is_some());
        assert!(state.publish("main", snapshot(3)).unwrap().is_some());
        let mut late = snapshot(2);
        late.session_id = Some("old".into());
        assert!(state.publish("main", late).unwrap().is_none());
        assert!(state.0.lock().unwrap().session_id.is_none());
    }

    #[test]
    fn snapshot_limits_and_finite_appearance_values_are_enforced() {
        let mut localized = snapshot(1);
        localized.ui_language = Some("en".into());
        assert!(validate(&localized).is_ok());
        let serialized = serde_json::to_value(&localized).unwrap();
        assert_eq!(serialized["uiLanguage"], "en");
        localized.ui_language = Some("unsupported".into());
        assert!(validate(&localized).is_err());
        let mut paragraph = snapshot(1);
        paragraph.caption_layout = "paragraph".into();
        assert!(validate(&paragraph).is_ok());
        paragraph.caption_layout = "unsafe".into();
        assert!(validate(&paragraph).is_err());
        let mut invalid = snapshot(1);
        invalid.background_opacity = f64::NAN;
        assert!(validate(&invalid).is_err());
        invalid = snapshot(1);
        invalid.font_size = 100;
        assert!(validate(&invalid).is_err());
        invalid = snapshot(1);
        invalid.mode = "compact".into();
        invalid.lines = (0..4)
            .map(|id| OverlayLine {
                paragraph_id: None,
                segment_id: format!("s-{id}"),
                color: None,
                revision: 1,
                r#final: true,
                translation_state: "pending".into(),
                source: "text".into(),
                translation: None,
                time: "00:00:00".into(),
            })
            .collect();
        assert!(validate(&invalid).is_err());
    }

    #[test]
    fn continuous_history_has_stable_unique_ids_and_bounded_character_cost() {
        let mut value = snapshot(1);
        value.lines = (0..160)
            .map(|id| OverlayLine {
                paragraph_id: None,
                segment_id: format!("caption-{id}"),
                color: None,
                revision: 1,
                r#final: true,
                translation_state: "ready".into(),
                source: "source".into(),
                translation: Some("译文".into()),
                time: "00:00:00".into(),
            })
            .collect();
        assert!(validate(&value).is_ok());
        value.lines[1].segment_id = value.lines[0].segment_id.clone();
        assert!(validate(&value).is_err());
        value.lines[1].segment_id = "caption-1".into();
        value.lines[0].source = "a".repeat(6000);
        for line in &mut value.lines[1..10] {
            line.source = "你".repeat(6000);
        }
        assert!(validate(&value).is_err());
        value.lines.clear();
        value.text_color = "url(secret)".into();
        assert!(validate(&value).is_err());
        value.text_color = "#ffffff".into();
        value.line_height = f64::INFINITY;
        assert!(validate(&value).is_err());
    }

    #[test]
    fn custom_rgb_colors_are_supported_but_css_values_are_rejected() {
        let mut value = snapshot(1);
        value.color_mode = "custom".into();
        value.text_color = "#12Ab34".into();
        value.lines.push(OverlayLine {
            paragraph_id: None,
            segment_id: "expression:test".into(),
            color: Some("#80deea".into()),
            revision: 1,
            r#final: true,
            translation_state: "pending".into(),
            source: "你好".into(),
            translation: None,
            time: "00:00:00".into(),
        });
        assert!(validate(&value).is_ok());
        value.lines[0].color = Some("url(secret)".into());
        assert!(validate(&value).is_err());
        let mut old = serde_json::to_value(snapshot(1)).unwrap();
        old.as_object_mut().unwrap().remove("colorMode");
        let migrated: OverlaySnapshot = serde_json::from_value(old).unwrap();
        assert_eq!(migrated.color_mode, "workspace");
    }

    #[test]
    fn subtitle_capability_has_no_credentials_network_or_publish_permissions() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/subtitle.json")).unwrap();
        assert_eq!(capability["windows"], serde_json::json!(["subtitle"]));
        let permissions = capability["permissions"].as_array().unwrap();
        let allowed = [
            // Metadata-only append; the floating window cannot read or export logs.
            "allow-record-diagnostic",
            "core:event:allow-listen",
            "core:event:allow-unlisten",
            "allow-drag-overlay",
            "allow-resize-overlay",
            "allow-read-overlay-voice",
            "allow-overlay-voice-action",
            "allow-read-overlay",
            "allow-focus-main",
            "allow-stop-overlay-listening",
        ];
        assert_eq!(permissions.len(), allowed.len());
        assert!(permissions
            .iter()
            .all(|permission| allowed.contains(&permission.as_str().unwrap())));
    }
}
