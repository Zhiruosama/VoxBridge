//! macOS main-window zoom and WebView sizing share the native resize lifecycle.
#[cfg(target_os = "macos")]
mod mac {
    use objc2::{define_class, rc::Retained, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSAutoresizingMaskOptions as Mask, NSView, NSWindow,
        NSWindowDidChangeBackingPropertiesNotification, NSWindowDidResizeNotification,
        NSWindowStyleMask,
    };
    use objc2_foundation::{
        NSNotification, NSNotificationCenter, NSObject, NSObjectProtocol, NSRect,
    };
    use std::{
        cell::{Cell, RefCell},
        collections::BTreeMap,
    };

    pub struct State {
        window: Retained<NSWindow>,
        view: Retained<NSView>,
        restore: Cell<Option<NSRect>>,
        #[cfg(debug_assertions)]
        resize_events: Cell<usize>,
    }
    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "VoxBridgeMainGeometryObserver"]
        #[thread_kind = MainThreadOnly]
        #[ivars = State]
        pub struct Observer;
        unsafe impl NSObjectProtocol for Observer {}
        impl Observer {
            #[unsafe(method(resized:))]
            fn resized(&self, _: &NSNotification) {
                #[cfg(debug_assertions)]
                self.ivars().resize_events.set(self.ivars().resize_events.get()+1);
                self.fit();
            }
        }
    );
    impl Observer {
        fn fit(&self) {
            let state = self.ivars();
            // Work in AppKit logical points, never in event physical pixels.
            if let Some(parent) = unsafe { state.view.superview() } {
                let bounds = parent.bounds();
                if state.view.frame() != bounds {
                    state.view.setFrame(bounds);
                }
            }
        }
        fn toggle(&self) {
            let state = self.ivars();
            if state
                .window
                .styleMask()
                .contains(NSWindowStyleMask::FullScreen)
            {
                return;
            }
            let Some(screen) = state.window.screen() else {
                return;
            };
            let current = state.window.frame();
            let maximum = screen.visibleFrame();
            let near = |a: f64, b: f64| (a - b).abs() < 2.0;
            let filled = near(current.origin.x, maximum.origin.x)
                && near(current.origin.y, maximum.origin.y)
                && near(current.size.width, maximum.size.width)
                && near(current.size.height, maximum.size.height);
            let target = if filled {
                state.restore.take().unwrap_or_else(|| {
                    let mut normal = maximum;
                    normal.size.width *= 0.8;
                    normal.size.height *= 0.8;
                    normal.origin.x += maximum.size.width * 0.1;
                    normal.origin.y += maximum.size.height * 0.1;
                    normal
                })
            } else {
                state.restore.set(Some(current));
                maximum
            };
            let target = visible_restore(target, maximum);
            // Unlike the default zoom path, request AppKit's smooth frame resize
            // explicitly. Native view autoresizing also runs throughout the resize.
            state.window.setFrame_display_animate(target, true, true);
            self.fit();
        }
    }
    fn visible_restore(mut frame: NSRect, screen: NSRect) -> NSRect {
        frame.size.width = frame.size.width.min(screen.size.width);
        frame.size.height = frame.size.height.min(screen.size.height);
        frame.origin.x = frame.origin.x.clamp(
            screen.origin.x,
            screen.origin.x + screen.size.width - frame.size.width,
        );
        frame.origin.y = frame.origin.y.clamp(
            screen.origin.y,
            screen.origin.y + screen.size.height - frame.size.height,
        );
        frame
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        use objc2_foundation::{NSPoint, NSSize};
        #[test]
        fn restore_stays_on_current_display_with_negative_origins_and_different_scales() {
            let screen = NSRect::new(NSPoint::new(-2560.0, 900.0), NSSize::new(2560.0, 1400.0));
            let normal = NSRect::new(NSPoint::new(-2200.0, 1000.0), NSSize::new(1180.0, 820.0));
            assert_eq!(visible_restore(normal, screen), normal);
            let displaced = NSRect::new(NSPoint::new(300.0, -400.0), normal.size);
            let result = visible_restore(displaced, screen);
            assert_eq!(result.origin, NSPoint::new(-1180.0, 900.0));
            let oversized = NSRect::new(displaced.origin, NSSize::new(5000.0, 3000.0));
            assert_eq!(visible_restore(oversized, screen), screen);
        }
    }
    thread_local! { static OBSERVERS: RefCell<BTreeMap<String, Retained<Observer>>> = const { RefCell::new(BTreeMap::new()) }; }
    pub fn install(window: &tauri::WebviewWindow) -> tauri::Result<()> {
        let label = window.label().to_string();
        window.with_webview(move |webview| {
            let mtm = MainThreadMarker::new().unwrap();
            let native =
                unsafe { Retained::retain(webview.ns_window().cast::<NSWindow>()).unwrap() };
            let view = unsafe { Retained::retain(webview.inner().cast::<NSView>()).unwrap() };
            let mask = Mask::ViewWidthSizable | Mask::ViewHeightSizable;
            view.setAutoresizingMask(mask);
            if let Some(parent) = unsafe { view.superview() } {
                parent.setAutoresizingMask(mask);
                parent.setAutoresizesSubviews(true);
            }
            let observer = Observer::alloc(mtm).set_ivars(State {
                window: native.clone(),
                view,
                restore: Cell::new(None),
                #[cfg(debug_assertions)]
                resize_events: Cell::new(0),
            });
            let observer: Retained<Observer> = unsafe { objc2::msg_send![super(observer), init] };
            let center = NSNotificationCenter::defaultCenter();
            for name in [unsafe { NSWindowDidResizeNotification }, unsafe {
                NSWindowDidChangeBackingPropertiesNotification
            }] {
                unsafe {
                    center.addObserver_selector_name_object(
                        &observer,
                        objc2::sel!(resized:),
                        Some(name),
                        Some(&*native),
                    );
                }
            }
            observer.fit();
            OBSERVERS.with(|items| {
                items.borrow_mut().insert(label, observer);
            });
        })
    }
    #[cfg(debug_assertions)]
    pub fn regression(label: &str) -> Result<String, String> {
        let observer = OBSERVERS
            .with(|items| items.borrow().get(label).cloned())
            .ok_or("not installed")?;
        let state = observer.ivars();
        let initial = state.window.frame();
        let before = state.resize_events.get();
        let start = std::time::Instant::now();
        observer.toggle();
        let elapsed = start.elapsed().as_millis();
        let parent = unsafe { state.view.superview() }.unwrap();
        assert_eq!(state.view.frame(), parent.bounds());
        assert_eq!(
            state.window.frame(),
            state.window.screen().unwrap().visibleFrame()
        );
        observer.toggle();
        assert_eq!(state.window.frame(), initial);
        assert_eq!(state.view.frame(), parent.bounds());
        let events = state.resize_events.get() - before;
        assert!(
            events > 2,
            "expected intermediate native resize frames, got {events}"
        );
        // Exercise a stale WebView frame and normal resize on each backing scale.
        for screen in objc2_app_kit::NSScreen::screens(MainThreadMarker::new().unwrap()).iter() {
            let mut frame = screen.visibleFrame();
            frame.origin.x += 40.0;
            frame.origin.y += 40.0;
            frame.size.width = frame.size.width.min(1100.0) - 80.0;
            frame.size.height = frame.size.height.min(800.0) - 80.0;
            state.view.setFrame(NSRect::ZERO);
            state.window.setFrame_display(frame, true);
            observer.fit();
            assert_eq!(state.view.frame(), parent.bounds());
        }
        state.window.setFrame_display(initial, true);
        observer.fit();
        Ok(format!("PASS: animated zoom/restore, {events} resize notifications, zoom {elapsed}ms; view fits content on every display"))
    }
    pub fn toggle(label: &str) -> Result<(), String> {
        let observer = OBSERVERS
            .with(|items| items.borrow().get(label).cloned())
            .ok_or("窗口尚未准备好，请重试。")?;
        observer.toggle();
        Ok(())
    }
}
#[cfg(target_os = "macos")]
pub use mac::install;
#[cfg(all(target_os = "macos", debug_assertions))]
#[allow(unused_imports)]
pub use mac::regression;

#[tauri::command]
pub async fn zoom_main_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("只有主窗口可以缩放。".into());
    }
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(mac::toggle("main"));
            })
            .map_err(|e| e.to_string())?;
        rx.await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    window.toggle_maximize().map_err(|e| e.to_string())
}
