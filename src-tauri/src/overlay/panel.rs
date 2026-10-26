//! A real nonactivating NSPanel. Never change TaoWindow's Objective-C class or
//! superclass: its allocation layout and event implementation belong to Tao.
use objc2::{define_class, rc::Retained, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSColor, NSEvent, NSPanel, NSStatusWindowLevel, NSWindow, NSWindowDelegate,
    NSWindowOcclusionState, NSWindowStyleMask, NSWorkspace,
    NSWorkspaceActiveSpaceDidChangeNotification,
};
use objc2_foundation::{NSNotification, NSObject, NSObjectProtocol, NSPoint, NSString};
use std::{cell::RefCell, path::PathBuf};
use tauri::Manager;

define_class!(
    #[unsafe(super(NSPanel))]
    #[name = "VoxBridgeSubtitlePanel"]
    #[thread_kind = MainThreadOnly]
    struct SubtitlePanel;
    unsafe impl NSObjectProtocol for SubtitlePanel {}
    impl SubtitlePanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key(&self) -> bool { true }
        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main(&self) -> bool { false }
    }
);
struct DelegateIvars {
    log: PathBuf,
}
define_class!(
    #[unsafe(super(NSObject))]
    #[name = "VoxBridgeSubtitlePanelDelegate"]
    #[thread_kind = MainThreadOnly]
    #[ivars = DelegateIvars]
    struct PanelDelegate;
    unsafe impl NSObjectProtocol for PanelDelegate {}
    impl PanelDelegate {
        #[unsafe(method(activeSpaceChanged:))]
        fn active_space_changed(&self, _: &NSNotification) {
            PANEL.with(|state| {
                if let Ok(current) = state.try_borrow() {
                    if let Some(item) = current.as_ref() { record_visibility(&item.panel, &self.ivars().log); }
                }
            });
        }
    }
    unsafe impl NSWindowDelegate for PanelDelegate {
        #[unsafe(method(windowDidChangeOcclusionState:))]
        fn occlusion_changed(&self, notification: &NSNotification) {
            if let Some(window) = notification
                .object()
                .and_then(|object| object.downcast::<NSWindow>().ok())
            {
                record_visibility(&window, &self.ivars().log);
            }
        }
    }
);
struct FloatingPanel {
    panel: Retained<SubtitlePanel>,
    _delegate: Retained<PanelDelegate>,
    drag: Option<PanelDrag>,
}
// Browser screen coordinates can change their scale/origin when WKWebView
// crosses displays. Both the anchor and subsequent samples must use AppKit's
// global logical points, including screens above/left of the primary display.
struct PanelDrag {
    id: String,
    origin: NSPoint,
    cursor: NSPoint,
}
impl PanelDrag {
    fn origin_at(&self, cursor: NSPoint) -> NSPoint {
        NSPoint::new(
            self.origin.x + (cursor.x - self.cursor.x),
            self.origin.y + (cursor.y - self.cursor.y),
        )
    }
}
thread_local! { static PANEL: RefCell<Option<FloatingPanel>> = const { RefCell::new(None) }; }

fn record_visibility(window: &NSWindow, path: &std::path::Path) {
    // Local, non-content diagnostics: unlike a window-targeted screenshot, these
    // values describe whether AppKit is actually presenting the panel now.
    let value = serde_json::json!({
        "observedAtMs": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|time| time.as_millis()).unwrap_or(0),
        "windowNumber": window.windowNumber(), "visible": window.isVisible(),
        "onActiveSpace": window.isOnActiveSpace(),
        "unoccluded": window.occlusionState().contains(NSWindowOcclusionState::Visible),
        "level": window.level(), "panel": true,
        "frame": { "x": window.frame().origin.x, "y": window.frame().origin.y, "width": window.frame().size.width, "height": window.frame().size.height },
    });
    let _ = std::fs::write(path, value.to_string());
}

pub(super) fn show(window: &tauri::WebviewWindow) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("字幕窗必须在主线程显示。")?;
    PANEL.with(|state| {
        let mut current = state.borrow_mut();
        if current.is_none() {
            let raw = window.ns_window().map_err(|_| "无法读取字幕窗。")?;
            if raw.is_null() {
                return Err("字幕窗不可用。".into());
            }
            // Borrow only while the owning Tauri window is retained by this call.
            let original = unsafe { &*raw.cast::<NSWindow>() };
            let content = original.contentView().ok_or("字幕内容不可用。")?;
            let allocated = SubtitlePanel::alloc(mtm).set_ivars(());
            let panel: Retained<SubtitlePanel> = unsafe { objc2::msg_send![super(allocated),
                initWithContentRect: original.frame(),
                styleMask: NSWindowStyleMask::Borderless | NSWindowStyleMask::Resizable | NSWindowStyleMask::NonactivatingPanel,
                backing: NSBackingStoreType::Buffered, defer: false
            ] };
            // The thread-local owner retains the panel until application exit.
            unsafe { panel.setReleasedWhenClosed(false); }
            panel.setTitle(&NSString::from_str("VoxBridge 字幕"));
            panel.setCollectionBehavior(super::subtitle_collection_behavior(
                panel.collectionBehavior(),
            ));
            panel.setHidesOnDeactivate(false);
            panel.setFloatingPanel(true);
            panel.setBecomesKeyOnlyIfNeeded(false);
            // setFloatingPanel may reset the level; apply the elevated level last.
            panel.setLevel(NSStatusWindowLevel);
            panel.setOpaque(false);
            panel.setBackgroundColor(Some(&NSColor::clearColor()));
            panel.setHasShadow(true);
            panel.setContentMinSize(original.contentMinSize());
            let directory = window.app_handle().path().app_log_dir().map_err(|_| "无法初始化字幕窗诊断。")?;
            let _ = std::fs::create_dir_all(&directory);
            let allocated = PanelDelegate::alloc(mtm).set_ivars(DelegateIvars { log: directory.join("overlay-window.json") });
            let delegate: Retained<PanelDelegate> = unsafe { objc2::msg_send![super(allocated), init] };
            // Move the complete root view only after all fallible initialization.
            // Its WKWebView keeps its original Tauri label and IPC identity.
            original.setContentView(None);
            panel.setContentView(Some(&content));
            original.orderOut(None);
            unsafe {
                NSWorkspace::sharedWorkspace().notificationCenter().addObserver_selector_name_object(
                    &delegate, objc2::sel!(activeSpaceChanged:), Some(NSWorkspaceActiveSpaceDidChangeNotification), None,
                );
            }
            panel.setDelegate(Some(objc2::runtime::ProtocolObject::from_ref(&*delegate)));
            *current = Some(FloatingPanel {
                panel,
                _delegate: delegate,
                drag: None,
            });
        }
        let item = current.as_ref().unwrap();
        item.panel.orderFrontRegardless();
        item.panel.makeKeyWindow();
        record_visibility(&item.panel, &item._delegate.ivars().log);
        Ok(())
    })
}
pub(super) fn hide() {
    PANEL.with(|state| {
        if let Some(item) = state.borrow().as_ref() {
            item.panel.orderOut(None);
        }
    });
}
pub(super) fn drag(id: String, phase: &str, x: f64, y: f64) -> Result<(), String> {
    if id.len() > 128 || !x.is_finite() || !y.is_finite() || x.abs() > 20000.0 || y.abs() > 20000.0
    {
        return Err("字幕拖动坐标无效。".into());
    }
    PANEL.with(|state| {
        let mut current = state.borrow_mut();
        let item = current.as_mut().ok_or("字幕窗尚未打开。")?;
        match phase {
            "begin" => {
                item.drag = Some(PanelDrag {
                    id,
                    origin: item.panel.frame().origin,
                    cursor: NSEvent::mouseLocation(),
                });
            }
            "move" => {
                if let Some(drag) = &item.drag {
                    if drag.id == id {
                        item.panel
                            .setFrameOrigin(drag.origin_at(NSEvent::mouseLocation()));
                    }
                }
            }
            "end" => {
                if item.drag.as_ref().is_some_and(|drag| drag.id == id) {
                    item.drag = None;
                    record_visibility(&item.panel, &item._delegate.ivars().log);
                }
            }
            _ => return Err("字幕拖动状态无效。".into()),
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drag_keeps_cursor_offset_across_display_origins_and_backtracking() {
        let drag = PanelDrag {
            id: "drag".into(),
            origin: NSPoint::new(1100.0, 200.0),
            cursor: NSPoint::new(1150.0, 450.0),
        };
        // AppKit logical points are independent of backing scale. Preserve the
        // grabbed offset on a display right of, left of, or above the primary.
        for cursor in [
            NSPoint::new(1700.0, 480.0),
            NSPoint::new(-600.0, 300.0),
            NSPoint::new(300.0, 1500.0),
            NSPoint::new(400.0, -500.0),
            drag.cursor,
        ] {
            let origin = drag.origin_at(cursor);
            assert_eq!(cursor.x - origin.x, 50.0);
            assert_eq!(cursor.y - origin.y, 250.0);
        }
        assert_eq!(drag.origin_at(drag.cursor), drag.origin);
    }
}
