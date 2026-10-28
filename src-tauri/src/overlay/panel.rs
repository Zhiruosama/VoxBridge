//! A real nonactivating NSPanel. Never change TaoWindow's Objective-C class or
//! superclass: its allocation layout and event implementation belong to Tao.
use objc2::{define_class, rc::Retained, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSApplication, NSBackingStoreType, NSColor, NSEvent, NSEventType, NSFloatingWindowLevel,
    NSPanel, NSStatusWindowLevel, NSTextInputContext, NSView, NSWindow, NSWindowDelegate,
    NSWindowOcclusionState, NSWindowStyleMask, NSWorkspace,
    NSWorkspaceActiveSpaceDidChangeNotification,
};
use objc2_foundation::{
    NSNotification, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString,
};
use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
    path::PathBuf,
};
use tauri::Manager;

#[path = "panel/content.rs"]
mod content;

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
        #[unsafe(method(sendEvent:))]
        fn send_event(&self, event: &NSEvent) {
            unsafe { let _: () = objc2::msg_send![super(self), sendEvent: event]; }
            if event.r#type() == NSEventType::LeftMouseDown {
                // A WKWebView can keep DOM focus across Spaces. Clicking its
                // already-focused editor does not emit another DOM focus event.
                queue_text_focus(self.windowNumber());
            }
        }
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
                    for item in current.values() { record_visibility(&item.panel, &item._delegate.ivars().log); }
                }
            });
        }
    }
    unsafe impl NSWindowDelegate for PanelDelegate {
        #[unsafe(method(windowDidBecomeKey:))]
        fn became_key(&self, notification: &NSNotification) {
            if let Some(window) = notification.object().and_then(|o| o.downcast::<NSWindow>().ok()) {
                queue_text_focus(window.windowNumber());
            }
        }
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
    editing: Cell<bool>,
    focus_epoch: Cell<u64>,
    drag: Option<PanelDrag>,
    resize: Option<PanelResize>,
}
// Browser screen coordinates can change their scale/origin when WKWebView
// crosses displays. Both the anchor and subsequent samples must use AppKit's
// global logical points, including screens above/left of the primary display.
struct PanelResize {
    id: String,
    frame: super::resize::Rect,
    cursor: NSPoint,
    direction: tauri_runtime::ResizeDirection,
}
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
thread_local! { static PANEL: RefCell<BTreeMap<String, FloatingPanel>> = const { RefCell::new(BTreeMap::new()) }; }

fn record_visibility(window: &NSWindow, path: &std::path::Path) {
    // Local, non-content diagnostics: unlike a window-targeted screenshot, these
    // values describe whether AppKit is actually presenting the panel now.
    let value = serde_json::json!({
        "observedAtMs": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|time| time.as_millis()).unwrap_or(0),
        "windowNumber": window.windowNumber(), "visible": window.isVisible(),
        "onActiveSpace": window.isOnActiveSpace(),
        "unoccluded": window.occlusionState().contains(NSWindowOcclusionState::Visible),
        "level": window.level(), "panel": true, "key": window.isKeyWindow(),
        "currentInputContext": MainThreadMarker::new().is_some_and(|mtm| NSTextInputContext::currentInputContext(mtm).is_some()),
        "inputContext": window.firstResponder().and_then(|r| r.downcast::<NSView>().ok()).is_some_and(|view| view.inputContext().is_some()),
        "frontmost": NSWorkspace::sharedWorkspace().frontmostApplication().is_some_and(|app| app.processIdentifier() == std::process::id() as i32),
        "frame": { "x": window.frame().origin.x, "y": window.frame().origin.y, "width": window.frame().size.width, "height": window.frame().size.height },
    });
    let _ = std::fs::write(path, value.to_string());
}

pub(super) fn show(window: &tauri::WebviewWindow) -> Result<(), String> {
    prepare(window, true)
}
// Separating preparation from presentation also permits an invisible native regression.
pub(super) fn prepare(window: &tauri::WebviewWindow, reveal: bool) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("字幕窗必须在主线程显示。")?;
    PANEL.with(|state| {
        let mut current = state.borrow_mut();
        let label = window.label();
        if !current.contains_key(label) {
            let raw = window.ns_window().map_err(|_| "无法读取字幕窗。")?;
            if raw.is_null() {
                return Err("字幕窗不可用。".into());
            }
            // Borrow only while the owning Tauri window is retained by this call.
            let original = unsafe { &*raw.cast::<NSWindow>() };
            let allocated = SubtitlePanel::alloc(mtm).set_ivars(());
            let panel: Retained<SubtitlePanel> = unsafe { objc2::msg_send![super(allocated),
                initWithContentRect: original.frame(),
                styleMask: NSWindowStyleMask::Borderless | NSWindowStyleMask::Resizable | NSWindowStyleMask::NonactivatingPanel,
                backing: NSBackingStoreType::Buffered, defer: false
            ] };
            // The thread-local owner retains the panel until application exit.
            unsafe { panel.setReleasedWhenClosed(false); }
            panel.setTitle(&NSString::from_str(&window.title().unwrap_or_else(|_| "VoxBridge".into())));
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
            // AppKit shadows on a transparent, resizable panel produce a dark
            // rectangular rim. The rounded web surfaces draw a subtle shadow
            // inside transparent window padding instead.
            panel.setHasShadow(false);
            panel.setContentMinSize(original.contentMinSize());
            let directory = window.app_handle().path().app_log_dir().map_err(|_| "无法初始化字幕窗诊断。")?;
            let _ = std::fs::create_dir_all(&directory);
            let allocated = PanelDelegate::alloc(mtm).set_ivars(DelegateIvars { log: directory.join(if label == "subtitle" { "overlay-window.json" } else { "text-overlay-window.json" }) });
            let delegate: Retained<PanelDelegate> = unsafe { objc2::msg_send![super(allocated), init] };
            // Move the complete root view only after all fallible initialization.
            // Its WKWebView keeps its original Tauri label and IPC identity.
            content::transfer(original, &panel)?;
            original.orderOut(None);
            unsafe {
                NSWorkspace::sharedWorkspace().notificationCenter().addObserver_selector_name_object(
                    &delegate, objc2::sel!(activeSpaceChanged:), Some(NSWorkspaceActiveSpaceDidChangeNotification), None,
                );
            }
            panel.setDelegate(Some(objc2::runtime::ProtocolObject::from_ref(&*delegate)));
            current.insert(label.to_owned(), FloatingPanel {
                panel,
                _delegate: delegate,
                editing: Cell::new(false),
                focus_epoch: Cell::new(0),
                drag: None,
                resize: None,
            });
        }
        let item = current.get(label).unwrap();
        if reveal {
            item.panel.orderFrontRegardless();
            item.panel.makeKeyWindow();
        }
        record_visibility(&item.panel, &item._delegate.ivars().log);
        Ok(())
    })
}
// Explicit text entry is different from passive captions. A nonactivating
// status-level panel may receive keys while the IME remains bound to another
// frontmost app, and can also cover the candidate popup. Keep the same panel
// and Spaces flags, but give editing ordinary floating level and real activation.
fn queue_text_focus(number: isize) {
    dispatch2::DispatchQueue::main().exec_async(move || {
        let epoch = PANEL.with(|state| {
            state
                .borrow()
                .values()
                .find(|item| item.panel.windowNumber() == number)
                .filter(|item| {
                    item.editing.get() && item.panel.isVisible() && item.panel.isKeyWindow()
                })
                .map(|item| item.focus_epoch.get())
        });
        if let Some(epoch) = epoch {
            finish_text_focus(number, epoch, 0);
        }
    });
}

fn finish_text_focus(number: isize, epoch: u64, attempt: u8) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    // Release the RefCell borrow before invoking AppKit: activation and focus
    // changes synchronously call window delegates back into this module.
    let target = PANEL.with(|state| {
        state
            .borrow()
            .values()
            .find(|item| item.panel.windowNumber() == number)
            .filter(|item| {
                item.focus_epoch.get() == epoch
                    && item.editing.get()
                    && item.panel.isVisible()
                    && item.panel.isKeyWindow()
                    && item.panel.isOnActiveSpace()
            })
            .map(|item| (item.panel.clone(), item._delegate.ivars().log.clone()))
    });
    let Some((panel, log)) = target else {
        return;
    };
    let frontmost = NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .is_some_and(|app| app.processIdentifier() == std::process::id() as i32);
    if !frontmost {
        if attempt == 0 {
            #[allow(deprecated)]
            NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
        }
        // Activation completes asynchronously, especially in another app's
        // fullscreen Space. Rebind only after it completes, never while typing.
        if attempt < 8 {
            let when = dispatch2::DispatchTime::NOW.time(25_000_000);
            let _ = dispatch2::DispatchQueue::main()
                .after(when, move || finish_text_focus(number, epoch, attempt + 1));
        }
        record_visibility(&panel, &log);
        return;
    }
    panel.makeKeyWindow();
    if let Some(responder) = panel.firstResponder() {
        panel.makeFirstResponder(Some(&responder));
        if let Ok(view) = responder.downcast::<NSView>() {
            if let Some(context) = view.inputContext() {
                context.invalidateCharacterCoordinates();
            }
        }
    }
    record_visibility(&panel, &log);
}

pub(super) fn text_input(label: &str, active: bool) -> Result<(), String> {
    MainThreadMarker::new().ok_or("字幕窗必须在主线程显示。")?;
    PANEL.with(|state| {
        let current = state.borrow();
        let Some(item) = current.get(label) else {
            return if active {
                Err("字幕窗尚未打开。".into())
            } else {
                Ok(())
            };
        };
        if active && !item.panel.isVisible() {
            return Err("字幕窗尚未显示。".into());
        }
        item.editing.set(active);
        item.focus_epoch.set(item.focus_epoch.get().wrapping_add(1));
        if active {
            item.panel.setLevel(NSFloatingWindowLevel);
            item.panel.makeKeyWindow();
            queue_text_focus(item.panel.windowNumber());
        } else {
            item.panel.setLevel(NSStatusWindowLevel);
        }
        record_visibility(&item.panel, &item._delegate.ivars().log);
        Ok(())
    })
}
pub(super) fn hide(label: &str) {
    PANEL.with(|state| {
        if let Some(item) = state.borrow_mut().get_mut(label) {
            item.editing.set(false);
            item.focus_epoch.set(item.focus_epoch.get().wrapping_add(1));
            item.panel.setLevel(NSStatusWindowLevel);
            item.drag = None;
            item.resize = None;
            item.panel.orderOut(None);
        }
    });
}
pub(super) fn drag(label: &str, id: String, phase: &str, x: f64, y: f64) -> Result<(), String> {
    if id.len() > 128 || !x.is_finite() || !y.is_finite() || x.abs() > 20000.0 || y.abs() > 20000.0
    {
        return Err("字幕拖动坐标无效。".into());
    }
    PANEL.with(|state| {
        let mut current = state.borrow_mut();
        let item = current.get_mut(label).ok_or("字幕窗尚未打开。")?;
        match phase {
            "begin" => {
                item.resize = None;
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

pub(super) fn resize(
    label: &str,
    id: String,
    phase: &str,
    direction: tauri_runtime::ResizeDirection,
) -> Result<(), String> {
    PANEL.with(|state| {
        let mut current = state.borrow_mut();
        let item = current.get_mut(label).ok_or("字幕窗尚未打开。")?;
        // A lost capture/end must not sample a cursor that has already moved
        // elsewhere after the mouse was released.
        if phase == "end" {
            if item.resize.as_ref().is_some_and(|resize| resize.id == id) {
                item.resize = None;
                record_visibility(&item.panel, &item._delegate.ivars().log);
            }
            return Ok(());
        }
        if phase == "begin" {
            let frame = item.panel.frame();
            item.drag = None;
            item.resize = Some(PanelResize {
                id,
                direction,
                cursor: NSEvent::mouseLocation(),
                frame: super::resize::Rect {
                    x: frame.origin.x,
                    y: frame.origin.y,
                    width: frame.size.width,
                    height: frame.size.height,
                },
            });
        } else if let Some(resize) = &item.resize {
            if resize.id != id {
                return Ok(());
            }
            let cursor = NSEvent::mouseLocation();
            let minimum = item.panel.contentMinSize();
            let frame = super::resize::frame(
                resize.frame,
                resize.direction,
                cursor.x - resize.cursor.x,
                cursor.y - resize.cursor.y,
                minimum.width.max(240.0),
                minimum.height.max(120.0),
            );
            item.panel.setFrame_display(
                NSRect::new(
                    NSPoint::new(frame.x, frame.y),
                    NSSize::new(frame.width, frame.height),
                ),
                true,
            );
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
