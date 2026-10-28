//! macOS main-window zoom and WebView sizing share the native resize lifecycle.
#[cfg(target_os = "macos")]
mod mac {
    use objc2::{
        define_class, rc::Retained, runtime::AnyObject, DefinedClass, MainThreadMarker,
        MainThreadOnly,
    };
    use objc2_app_kit::{
        NSAnimatablePropertyContainer, NSAnimationContext, NSAutoresizingMaskOptions as Mask,
        NSEvent, NSEventMask, NSView, NSWindow, NSWindowDidChangeBackingPropertiesNotification,
        NSWindowDidResizeNotification, NSWindowStyleMask,
    };
    use objc2_foundation::{
        NSNotification, NSNotificationCenter, NSObject, NSObjectProtocol, NSRect,
    };
    use std::{
        cell::{Cell, RefCell},
        collections::BTreeMap,
        ptr::NonNull,
    };

    pub struct State {
        window: Retained<NSWindow>,
        view: Retained<NSView>,
        restore: Cell<Option<NSRect>>,
        label: String,
        animation: Cell<Option<NSRect>>,
        generation: Cell<u64>,
        // Retain the local monitor for the lifetime of the main window.
        monitor: RefCell<Option<Retained<AnyObject>>>,
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
            // Reverse an in-flight zoom from its current frame rather than
            // letting the older animation overwrite a newer double click.
            let destination = state.animation.get().unwrap_or(current);
            let filled = near(destination.origin.x, maximum.origin.x)
                && near(destination.origin.y, maximum.origin.y)
                && near(destination.size.width, maximum.size.width)
                && near(destination.size.height, maximum.size.height);
            let target = if filled {
                state.restore.get().unwrap_or_else(|| {
                    let mut normal = maximum;
                    normal.size.width *= 0.8;
                    normal.size.height *= 0.8;
                    normal.origin.x += maximum.size.width * 0.1;
                    normal.origin.y += maximum.size.height * 0.1;
                    normal
                })
            } else {
                if state.animation.get().is_none() {
                    state.restore.set(Some(current));
                }
                maximum
            };
            let target = visible_restore(target, maximum);
            let generation = state.generation.get().wrapping_add(1);
            state.generation.set(generation);
            state.animation.set(Some(target));
            let native = state.window.clone();
            let changes = block2::RcBlock::new(move |_: NonNull<NSAnimationContext>| {
                // AppKit owns timing, interpolation and frame scheduling. Use
                // its asynchronous animator proxy rather than a custom timer
                // or the synchronous setFrame:display:animate: resize path.
                native.animator().setFrame_display(target, true);
            });
            let label = state.label.clone();
            let completed = block2::RcBlock::new(move || {
                let observer = OBSERVERS.with(|items| items.borrow().get(&label).cloned());
                if let Some(observer) = observer {
                    if observer.ivars().generation.get() == generation {
                        observer.ivars().animation.set(None);
                        observer.fit();
                    }
                }
            });
            NSAnimationContext::runAnimationGroup_completionHandler(&changes, Some(&completed));
        }
    }
    // y is measured down from the top of the native frame, in logical points.
    fn is_titlebar_double_click(window: isize, main: isize, clicks: isize, x: f64, y: f64) -> bool {
        window == main && clicks == 2 && x >= 82.0 && (0.0..32.0).contains(&y)
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
        fn native_titlebar_gesture_excludes_controls_content_and_other_windows() {
            assert!(is_titlebar_double_click(1, 1, 2, 700.0, 12.0));
            assert!(is_titlebar_double_click(1, 1, 2, 700.0, 30.0));
            for (window, clicks, x, y) in [
                (2, 2, 700.0, 12.0),
                (1, 1, 700.0, 12.0),
                (1, 3, 700.0, 12.0),
                (1, 2, 40.0, 12.0),
                (1, 2, 700.0, 40.0),
                (1, 2, 700.0, -1.0),
            ] {
                assert!(!is_titlebar_double_click(window, 1, clicks, x, y));
            }
        }
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
                label: label.clone(),
                animation: Cell::new(None),
                generation: Cell::new(0),
                monitor: RefCell::new(None),
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
            // AppKit's overlay titlebar consumes mouse events above the WebView.
            // Handle the native titlebar as well as its DOM-painted lower edge;
            // a React double-click alone never sees the upper native strip.
            let observed = observer.clone();
            let handler = block2::RcBlock::new(move |event: NonNull<NSEvent>| {
                let event_ref = unsafe { event.as_ref() };
                let state = observed.ivars();
                let point = event_ref.locationInWindow();
                let height = state.window.frame().size.height;
                if is_titlebar_double_click(
                    event_ref.windowNumber(),
                    state.window.windowNumber(),
                    event_ref.clickCount(),
                    point.x,
                    height - point.y,
                ) {
                    observed.toggle();
                    std::ptr::null_mut()
                } else {
                    event.as_ptr()
                }
            });
            *observer.ivars().monitor.borrow_mut() = unsafe {
                NSEvent::addLocalMonitorForEventsMatchingMask_handler(
                    NSEventMask::LeftMouseDown,
                    &handler,
                )
            };
            observer.fit();
            OBSERVERS.with(|items| {
                items.borrow_mut().insert(label, observer);
            });
        })
    }
    #[cfg(debug_assertions)]
    async fn inspect<R: Send + 'static>(
        window: &tauri::WebviewWindow,
        f: impl FnOnce(&Observer) -> Result<R, String> + Send + 'static,
    ) -> Result<R, String> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                let result = OBSERVERS
                    .with(|items| items.borrow().get("main").cloned())
                    .ok_or_else(|| "not installed".to_string())
                    .and_then(|observer| f(&observer));
                let _ = tx.send(result);
            })
            .map_err(|e| e.to_string())?;
        rx.await.map_err(|e| e.to_string())?
    }
    #[cfg(debug_assertions)]
    pub async fn regression(window: tauri::WebviewWindow) -> Result<String, String> {
        let (initial, before) = inspect(&window, |o| {
            let state = o.ivars();
            let result = (state.window.frame(), state.resize_events.get());
            o.toggle();
            // Starting the animation must return before it reaches the target.
            assert_eq!(state.window.frame(), result.0);
            Ok(result)
        })
        .await?;
        tokio::time::sleep(std::time::Duration::from_millis(160)).await;
        inspect(&window, move |o| {
            let state = o.ivars();
            assert_ne!(state.window.frame(), initial);
            assert_ne!(
                state.window.frame(),
                state.window.screen().unwrap().visibleFrame()
            );
            assert!(!state
                .window
                .styleMask()
                .contains(NSWindowStyleMask::FullScreen));
            Ok(())
        })
        .await?;
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        inspect(&window, |o| {
            let state = o.ivars();
            assert_eq!(
                state.window.frame(),
                state.window.screen().unwrap().visibleFrame()
            );
            assert_eq!(
                state.view.frame(),
                unsafe { state.view.superview() }.unwrap().bounds()
            );
            o.toggle();
            Ok(())
        })
        .await?;
        tokio::time::sleep(std::time::Duration::from_millis(550)).await;
        inspect(&window, move |o| {
            let state = o.ivars();
            assert_eq!(state.window.frame(), initial);
            assert!(!state.window.styleMask().contains(NSWindowStyleMask::FullScreen));
            let events = state.resize_events.get() - before;
            assert!(events > 2);
            for screen in objc2_app_kit::NSScreen::screens(MainThreadMarker::new().unwrap()).iter() {
                let mut frame = screen.visibleFrame();
                frame.origin.x += 40.0;
                frame.origin.y += 40.0;
                frame.size.width = frame.size.width.min(1100.0) - 80.0;
                frame.size.height = frame.size.height.min(800.0) - 80.0;
                state.view.setFrame(NSRect::ZERO);
                state.window.setFrame_display(frame, true);
                o.fit();
                assert_eq!(state.view.frame(), unsafe { state.view.superview() }.unwrap().bounds());
            }
            state.window.setFrame_display(initial, true);
            o.fit();
            Ok(format!("PASS: desktop zoom/restore, visible intermediate frame at 160ms, {events} resize events; fullscreen=false; all displays fit"))
        }).await
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
    {
        if window.is_maximized().map_err(|e| e.to_string())? {
            window.unmaximize().map_err(|e| e.to_string())
        } else {
            window.maximize().map_err(|e| e.to_string())
        }
    }
}
