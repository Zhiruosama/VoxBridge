//! Disposable real Mac window running the production header/theme hook.
//! Run the Vite server first. No user settings, credentials or audio are accessed.
#[cfg(target_os = "macos")]
fn main() {
    use objc2_app_kit::NSWindow;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tauri::{Listener, Manager};
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.voxbridge.native-theme-regression".into();
    tauri::Builder::default().setup(|app| {
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(
            "http://127.0.0.1:1420/src-tauri/examples/native-theme-regression.html".parse()?))
            .title("Native theme regression")
            .visible(true).focused(false).inner_size(700.0, 480.0)
            .decorations(true).title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(12.0,10.0))
            .background_color(tauri::utils::config::Color(24, 24, 24, 255))
            .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
            .build()?;
        let samples = Arc::new(Mutex::new((0usize, true, false, false)));
        let stats = samples.clone();
        app.listen("theme-probe-color", move |event| {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(event.payload()) else {return};
            let mut stats = stats.lock().unwrap();
            stats.0 += 1;
            if stats.0 == 1 { println!("First DOM sample: {}", v); }
            stats.1 &= v["header"] == v["body"] && v["text"] == true && v["height"] == 32 && v["width"] == v["viewport"] && v["inlineTokens"] == "";
            stats.2 |= v["header"] == "rgb(240, 240, 238)";
            stats.3 |= v["header"] == "rgb(24, 24, 24)";
        });
        let handle = app.handle().clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(if std::env::var_os("VOXBRIDGE_THEME_VISUAL").is_some() { 60 } else { 12 }));
            let app = handle.clone();
            handle.run_on_main_thread(move || {
                let window = app.get_webview_window("main").unwrap();
                let native = unsafe { &*window.ns_window().unwrap().cast::<NSWindow>() };
                let overlay = native.styleMask().contains(objc2_app_kit::NSWindowStyleMask::FullSizeContentView);
                let hidden = native.titleVisibility() == objc2_app_kit::NSWindowTitleVisibility::Hidden;
                let transparent = native.titlebarAppearsTransparent();
                let stats = samples.lock().unwrap();
                let passed = overlay && hidden && transparent && stats.0 > 30 && stats.1 && stats.2 && stats.3;
                println!("Mac shared chrome: {} frames, aligned={}, light={}, dark={}, native overlay={}, hidden title={}, transparent titlebar={} ({})", stats.0, stats.1, stats.2, stats.3, overlay, hidden, transparent, if passed {"PASS"} else {"FAIL"});
                app.exit(if passed {0} else {1});
            }).unwrap();
        });
        Ok(())
    }).run(context).expect("native theme regression failed");
}
#[cfg(not(target_os = "macos"))]
fn main() {
    println!("macOS-only native theme regression");
}
