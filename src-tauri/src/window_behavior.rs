//! Keep the main WebView alive: hide on macOS, minimize to the taskbar on Windows.
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CloseBehavior {
    Hide,
    Quit,
}

pub struct WindowBehavior(AtomicBool);
impl Default for WindowBehavior {
    fn default() -> Self {
        Self(AtomicBool::new(true))
    }
}
impl WindowBehavior {
    pub fn should_hide(&self, platform: &str, label: &str) -> bool {
        platform == "macos" && label == "main" && self.0.load(Ordering::SeqCst)
    }
    pub fn should_minimize(&self, platform: &str, label: &str) -> bool {
        platform == "windows" && label == "main" && self.0.load(Ordering::SeqCst)
    }
}

#[tauri::command]
pub fn set_main_close_behavior(behavior: CloseBehavior, state: tauri::State<'_, WindowBehavior>) {
    state
        .0
        .store(matches!(behavior, CloseBehavior::Hide), Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hides_only_mac_main_window_and_keeps_quit_explicit() {
        let policy = WindowBehavior::default();
        assert!(policy.should_hide("macos", "main"));
        assert!(!policy.should_hide("windows", "main"));
        assert!(!policy.should_hide("macos", "subtitle"));
        assert!(!policy.should_hide("macos", "setup"));
        policy.0.store(false, Ordering::SeqCst);
        assert!(!policy.should_hide("macos", "main"));
        assert!(serde_json::from_str::<CloseBehavior>("\"minimize\"").is_err());
    }
    #[test]
    fn windows_background_close_minimizes_only_main_and_quit_remains_explicit() {
        let policy = WindowBehavior::default();
        assert!(policy.should_minimize("windows", "main"));
        for (platform, label) in [
            ("macos", "main"),
            ("linux", "main"),
            ("windows", "subtitle"),
            ("windows", "text-overlay"),
            ("windows", "setup"),
        ] {
            assert!(!policy.should_minimize(platform, label));
        }
        policy.0.store(false, Ordering::SeqCst);
        assert!(!policy.should_minimize("windows", "main"));
    }
}
