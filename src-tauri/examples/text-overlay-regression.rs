//! Two invisible native panels using production ownership and content transfer.
//! This example never initializes clipboard access or calls any model service.
#[cfg(target_os = "macos")]
#[path = "../src/overlay/panel.rs"]
mod panel;
#[cfg(target_os = "macos")]
#[path = "../src/overlay/resize.rs"]
mod resize;
// This test only checks ownership/routing, not macOS Spaces presentation.
#[cfg(target_os = "macos")]
fn subtitle_collection_behavior(
    value: objc2_app_kit::NSWindowCollectionBehavior,
) -> objc2_app_kit::NSWindowCollectionBehavior {
    value
}
#[cfg(target_os = "macos")]
fn main() {
    use objc2_app_kit::NSWindow;
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.voxbridge.text-panel-regression".into();
    tauri::Builder::default().setup(|app| {
        let mut moved_views = Vec::new();
        for (label, width, height) in [("subtitle", 760.0, 320.0), ("text-overlay", 560.0, 280.0)] {
            let host = tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::External("about:blank".parse()?))
                .visible(false).inner_size(width, height).build()?;
            let native = unsafe { &*host.ns_window()?.cast::<NSWindow>() };
            let moved = native.contentView().unwrap();
            panel::prepare(&host, false).map_err(std::io::Error::other)?;
            assert!(!native.isVisible());
            assert_ne!(&*native.contentView().unwrap() as *const _, &*moved as *const _);
            for _ in 0..10 { panel::prepare(&host, false).map_err(std::io::Error::other)?; }
            let destination = moved.window().unwrap();
            assert_ne!(destination.windowNumber(), native.windowNumber());
            assert!(!destination.isVisible());
            panel::drag(label, "fixture".into(), "begin", 0.0, 0.0).map_err(std::io::Error::other)?;
            panel::drag(label, "fixture".into(), "end", 0.0, 0.0).map_err(std::io::Error::other)?;
            panel::resize(label, "resize".into(), "begin", tauri_runtime::ResizeDirection::SouthEast).map_err(std::io::Error::other)?;
            panel::resize(label, "resize".into(), "end", tauri_runtime::ResizeDirection::SouthEast).map_err(std::io::Error::other)?;
            panel::hide(label);
            moved_views.push(moved);
        }
        assert_ne!(moved_views[0].window().unwrap().windowNumber(), moved_views[1].window().unwrap().windowNumber());
        println!("PASS: independent audio/text panels, repeated preparation, per-window drag/resize/hide and valid hidden hosts");
        app.handle().exit(0); Ok(())
    }).run(context).expect("text panel regression failed");
}
#[cfg(not(target_os = "macos"))]
fn main() {
    println!("macOS-only panel regression");
}
