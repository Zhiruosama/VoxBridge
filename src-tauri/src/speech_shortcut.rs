use crate::speech::SpeechState;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcut, Modifiers, Shortcut, ShortcutState};

#[derive(Default)]
pub(crate) struct PlaybackShortcut(Mutex<Option<Shortcut>>);

fn parse_shortcut(value: &str) -> Result<Option<Shortcut>, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    let invalid = "请输入包含 Ctrl、Alt 或 Command 的有效组合键。";
    if value.len() > 80 {
        return Err(invalid.into());
    }
    let shortcut: Shortcut = value.parse().map_err(|_| invalid.to_string())?;
    if !shortcut
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
    {
        return Err(invalid.into());
    }
    Ok(Some(shortcut))
}

#[tauri::command]
pub(crate) async fn configure_playback_shortcut(
    shortcut: String,
    app: tauri::AppHandle,
    binding: tauri::State<'_, PlaybackShortcut>,
) -> Result<(), String> {
    let next = parse_shortcut(&shortcut)?;
    let mut current = binding.0.lock().map_err(|_| "快捷键状态不可用。")?;
    if *current == next {
        return Ok(());
    }
    let shortcuts = app
        .try_state::<GlobalShortcut<tauri::Wry>>()
        .ok_or("全局快捷键不可用。")?;
    if let Some(next) = next {
        let pressed = AtomicBool::new(false);
        shortcuts
            .on_shortcut(next, move |app, _, event| {
                if event.state() == ShortcutState::Released {
                    pressed.store(false, Ordering::SeqCst);
                } else if !pressed.swap(true, Ordering::SeqCst) {
                    let _ = app.state::<SpeechState>().toggle_playback(None);
                }
            })
            .map_err(|_| "注册全局快捷键失败，请尝试其他组合键。")?;
    }
    if let Some(previous) = *current {
        if shortcuts.unregister(previous).is_err() {
            if let Some(next) = next {
                let _ = shortcuts.unregister(next);
            }
            return Err("无法移除原来的全局快捷键。".into());
        }
    }
    *current = next;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_modified_chords_and_empty_toggle_but_rejects_typing_keys() {
        assert!(parse_shortcut(" ").unwrap().is_none());
        assert!(parse_shortcut("CommandOrControl+Shift+Space")
            .unwrap()
            .is_some());
        for invalid in ["Space", "Enter", "Shift+A", "Ctrl+oops"] {
            assert!(parse_shortcut(invalid).is_err());
        }
    }
}
