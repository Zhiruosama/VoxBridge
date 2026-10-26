//! macOS-only native regression, using disposable windows without credentials,
//! model requests or changes to the user's display configuration.
//! `cargo run --manifest-path src-tauri/Cargo.toml --example overlay-display-regression`
//! Add `-- --empty-content-control` to reproduce the old abort in this test process.
#[cfg(target_os = "macos")]
#[path = "../src/overlay/panel/content.rs"]
mod content;

#[cfg(target_os = "macos")]
fn main() {
    use objc2::msg_send;
    use objc2_app_kit::{NSScreen, NSWindow};
    use objc2_foundation::NSNotification;
    tauri::Builder::default()
        .setup(|app| {
            let original = tauri::WebviewWindowBuilder::new(app, "regression-host", tauri::WebviewUrl::External("about:blank".parse()?))
                .visible(false).inner_size(760.0, 320.0).build()?;
            let panel = tauri::WebviewWindowBuilder::new(app, "regression-panel", tauri::WebviewUrl::External("about:blank".parse()?))
                .visible(false).inner_size(760.0, 320.0).build()?;
            let native = unsafe { &*original.ns_window()?.cast::<NSWindow>() };
            let destination = unsafe { &*panel.ns_window()?.cast::<NSWindow>() };
            let moved = native.contentView().unwrap();
            if std::env::args().any(|arg| arg == "--empty-content-control") {
                native.setContentView(None);
                destination.setContentView(Some(&moved));
            } else {
                content::transfer(native, destination).map_err(std::io::Error::other)?;
                assert!(native.contentView().is_some());
                assert_eq!(&*destination.contentView().unwrap() as *const _, &*moved as *const _);
            }
            native.orderOut(None);
            let delegate = native.delegate().unwrap();
            // Resize always reads contentView, exercising the same unwrap as a
            // display backing-scale change without altering real monitors.
            let notification = unsafe { NSNotification::notificationWithName_object(
                objc2_foundation::ns_string!("VoxBridgeRegressionNotification"), None,
            ) };
            for _ in 0..20 {
                unsafe {
                    let _: () = msg_send![&*delegate, windowDidResize: &*notification];
                    let _: () = msg_send![&*delegate, windowDidChangeBackingProperties: &*notification];
                }
            }
            // Move only these invisible regression windows across the existing
            // display layout. This exercises real 1x/2x backing-scale changes;
            // it never changes a display setting or moves the user's windows.
            let screens = NSScreen::screens(objc2::MainThreadMarker::new().unwrap());
            for screen in &screens {
                let mut frame = native.frame();
                frame.origin.x = screen.frame().origin.x + 100.0;
                frame.origin.y = screen.frame().origin.y + 100.0;
                native.setFrame_display(frame, false);
                destination.setFrame_display(frame, false);
                assert!(native.contentView().is_some());
                println!("PASS: hidden host on display with backing scale {}", native.backingScaleFactor());
            }
            assert!(native.contentView().is_some());
            println!("PASS: hidden host survived 20 resize/backing-property callbacks after content transfer");
            app.handle().exit(0);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("native regression application failed");
}
#[cfg(not(target_os = "macos"))]
fn main() {
    println!("macOS-only native regression");
}
