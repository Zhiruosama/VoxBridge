//! Run `npm run dev`, then `cargo run --manifest-path src-tauri/Cargo.toml
//! --example native-theme-regression`. Samples a disposable native window while
//! the production useTheme hook changes themes. No user app data is loaded.
#[cfg(target_os = "macos")]
fn main() {
    use objc2_app_kit::NSWindow;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tauri::Manager;
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.voxbridge.native-theme-regression".into();
    tauri::Builder::default().setup(|app| {
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(
            "http://127.0.0.1:1420/src-tauri/examples/native-theme-regression.html".parse()?))
            .title("Native theme regression")
            .visible(true).focused(false).inner_size(700.0, 480.0)
            .title_bar_style(tauri::TitleBarStyle::Transparent)
            .background_color(tauri::utils::config::Color(24, 24, 24, 255))
            .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
            .build()?;
        let handle = app.handle().clone();
        let colors = Arc::new(Mutex::new(Vec::new()));
        std::thread::spawn(move || {
            for index in 0..250 {
                std::thread::sleep(Duration::from_millis(20));
                let app = handle.clone();
                let samples = colors.clone();
                handle.run_on_main_thread(move || {
                    let window = app.get_webview_window("main").unwrap();
                    let native = unsafe { &*window.ns_window().unwrap().cast::<NSWindow>() };
                    let color = native.backgroundColor();
                    let rgb = [color.redComponent(), color.greenComponent(), color.blueComponent()]
                        .map(|v| (v * 255.0).round() as u8);
                    samples.lock().unwrap().push(rgb);
                    if index == 249 {
                        let samples = samples.lock().unwrap();
                        let unique: std::collections::BTreeSet<_> = samples.iter().copied().collect();
                        let light = unique.contains(&[240, 240, 238]);
                        let dark = samples.last() == Some(&[24, 24, 24]);
                        let passed = unique.len() > 5 && light && dark;
                        println!("Native theme regression: {} native colors, reached light={}, ended dark={} ({})", unique.len(), light, dark, if passed {"PASS"} else {"FAIL"});
                        app.exit(if passed {0} else {1});
                    }
                }).unwrap();
            }
        });
        Ok(())
    }).run(context).expect("native theme regression failed");
}
#[cfg(not(target_os = "macos"))]
fn main() {
    println!("macOS-only native theme regression");
}
