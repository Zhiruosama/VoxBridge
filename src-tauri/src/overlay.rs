use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayLine {
    segment_id: String,
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
    version: u64,
    session_id: Option<String>,
    phase: String,
    font_size: u32,
    background_opacity: f64,
    mode: String,
    content: String,
    text_color: String,
    line_height: f64,
    lines: Vec<OverlayLine>,
}

impl Default for OverlaySnapshot {
    fn default() -> Self {
        Self {
            version: 0,
            session_id: None,
            phase: "idle".into(),
            font_size: 22,
            background_opacity: 0.82,
            mode: "continuous".into(),
            content: "translation".into(),
            text_color: "#ffffff".into(),
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
    if snapshot.version == 0
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
        || ![
            "#ffffff", "#ffe082", "#a5d6a7", "#80deea", "#ffcc80", "#f8bbd0",
        ]
        .contains(&snapshot.text_color.as_str())
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
            line.segment_id.is_empty()
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
pub fn show_overlay(window: tauri::WebviewWindow) -> Result<(), String> {
    require_main(window.label())?;
    let overlay = window
        .app_handle()
        .get_webview_window("subtitle")
        .ok_or("悬浮字幕窗不可用。")?;
    overlay.show().map_err(|_| "无法显示悬浮字幕窗。".into())
}

#[tauri::command]
pub fn hide_overlay(window: tauri::WebviewWindow) -> Result<(), String> {
    let overlay = window
        .app_handle()
        .get_webview_window("subtitle")
        .ok_or("悬浮字幕窗不可用。")?;
    overlay.hide().map_err(|_| "无法隐藏悬浮字幕窗。".into())
}

#[tauri::command]
pub fn focus_main(window: tauri::WebviewWindow) -> Result<(), String> {
    let main = window
        .app_handle()
        .get_webview_window("main")
        .ok_or("主窗口不可用。")?;
    main.show()
        .and_then(|_| main.unminimize())
        .and_then(|_| main.set_focus())
        .map_err(|_| "无法返回主窗口。".to_string())?;
    if window.label() == "subtitle" {
        window
            .hide()
            .map_err(|_| "主窗口已打开，但无法收起字幕窗。".to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn stop_overlay_listening(
    window: tauri::WebviewWindow,
    capture: tauri::State<'_, crate::capture::CaptureState>,
) -> Result<(), String> {
    capture.stop_all();
    window
        .app_handle()
        .emit_to("main", "overlay-stop-request", ())
        .map_err(|_| "停止请求通知失败，请返回主窗口。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

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
                segment_id: format!("s-{id}"),
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
                segment_id: format!("caption-{id}"),
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
    fn subtitle_capability_has_no_credentials_network_or_publish_permissions() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/subtitle.json")).unwrap();
        assert_eq!(capability["windows"], serde_json::json!(["subtitle"]));
        let permissions = capability["permissions"].as_array().unwrap();
        let allowed = [
            "core:event:allow-listen",
            "core:event:allow-unlisten",
            "core:window:allow-start-dragging",
            "core:window:allow-internal-toggle-maximize",
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
