//! Keep the main WebView alive. Windows hides only after a tray entry exists.
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CloseBehavior {
    Hide,
    Quit,
}

pub struct WindowBehavior {
    background: AtomicBool,
    tray_ready: AtomicBool,
}
impl Default for WindowBehavior {
    fn default() -> Self {
        Self {
            background: AtomicBool::new(true),
            tray_ready: AtomicBool::new(false),
        }
    }
}
impl WindowBehavior {
    pub fn should_hide(&self, platform: &str, label: &str) -> bool {
        label == "main"
            && self.background.load(Ordering::SeqCst)
            && (platform == "macos"
                || (platform == "windows" && self.tray_ready.load(Ordering::SeqCst)))
    }
    pub fn should_minimize(&self, platform: &str, label: &str) -> bool {
        platform == "windows"
            && label == "main"
            && self.background.load(Ordering::SeqCst)
            && !self.tray_ready.load(Ordering::SeqCst)
    }
    #[cfg(target_os = "windows")]
    pub fn enable_tray(&self) {
        self.tray_ready.store(true, Ordering::SeqCst);
    }
}

#[tauri::command]
pub fn set_main_close_behavior(behavior: CloseBehavior, state: tauri::State<'_, WindowBehavior>) {
    state
        .background
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
        policy.background.store(false, Ordering::SeqCst);
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
        policy.background.store(false, Ordering::SeqCst);
        assert!(!policy.should_minimize("windows", "main"));
    }
    #[test]
    fn tray_recovery_entry_is_required_to_hide_windows_and_quit_overrides_it() {
        let policy = WindowBehavior::default();
        assert!(!policy.should_hide("windows", "main"));
        assert!(policy.should_minimize("windows", "main"));
        policy.tray_ready.store(true, Ordering::SeqCst);
        assert!(policy.should_hide("windows", "main"));
        assert!(!policy.should_minimize("windows", "main"));
        for label in ["subtitle", "text-overlay", "setup"] {
            assert!(!policy.should_hide("windows", label));
        }
        policy.background.store(false, Ordering::SeqCst);
        assert!(!policy.should_hide("windows", "main"));
        assert!(!policy.should_minimize("windows", "main"));
    }
}
