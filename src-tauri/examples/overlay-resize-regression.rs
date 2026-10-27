//! Disposable, invisible NSPanel test. No microphones, model services or user window changes.
#[cfg(target_os = "macos")]
#[path = "../src/overlay/panel/content.rs"]
mod content;
#[cfg(target_os = "macos")]
#[path = "../src/overlay/resize.rs"]
mod resize;

#[cfg(target_os = "macos")]
fn main() {
    use objc2::{rc::Retained, MainThreadOnly};
    use objc2_app_kit::{NSBackingStoreType, NSPanel, NSWindow, NSWindowStyleMask};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    tauri::Builder::default().setup(|app| {
        let host = tauri::WebviewWindowBuilder::new(app, "resize-regression-host", tauri::WebviewUrl::External("about:blank".parse()?))
            .visible(false).inner_size(760.0, 320.0).build()?;
        let native = unsafe { &*host.ns_window()?.cast::<NSWindow>() };
        let mtm = objc2::MainThreadMarker::new().unwrap();
        let panel: Retained<NSPanel> = unsafe { objc2::msg_send![NSPanel::alloc(mtm),
            initWithContentRect: native.frame(),
            styleMask: NSWindowStyleMask::Borderless | NSWindowStyleMask::Resizable | NSWindowStyleMask::NonactivatingPanel,
            backing: NSBackingStoreType::Buffered, defer: false
        ] };
        unsafe { panel.setReleasedWhenClosed(false); }
        panel.setContentMinSize(NSSize::new(480.0, 220.0));
        content::transfer(native, &panel).map_err(std::io::Error::other)?;
        let original = resize::Rect { x: -900.0, y: 400.0, width: 760.0, height: 320.0 };
        use tauri_runtime::ResizeDirection::*;
        for direction in [North, South, East, West, NorthEast, NorthWest, SouthEast, SouthWest] {
            for (dx, dy) in [(100.0, 60.0), (-200.0, -70.0), (0.0, 0.0)] {
                let frame = resize::frame(original, direction, dx, dy, 480.0, 220.0);
                panel.setFrame_display(NSRect::new(NSPoint::new(frame.x, frame.y), NSSize::new(frame.width, frame.height)), false);
                let actual = panel.frame();
                assert_eq!(actual.size.width, frame.width);
                assert_eq!(actual.size.height, frame.height);
                let root = panel.contentView().unwrap();
                assert_eq!(root.frame().size.width, frame.width);
                assert_eq!(root.frame().size.height, frame.height);
                assert!(native.contentView().is_some());
            }
        }
        println!("PASS: all eight NSPanel resize directions update the transferred root view; hidden host remains valid");
        app.handle().exit(0);
        Ok(())
    }).run(tauri::generate_context!()).expect("resize regression failed");
}
#[cfg(not(target_os = "macos"))]
fn main() {
    println!("macOS-only NSPanel regression");
}
