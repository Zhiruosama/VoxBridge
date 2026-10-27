//! Run `npm run dev`, then `cargo run --manifest-path src-tauri/Cargo.toml
//! --example native-theme-regression`. Samples a disposable native window while
//! the production useTheme hook changes themes. No user app data is loaded.
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
            .title_bar_style(tauri::TitleBarStyle::Transparent)
            .background_color(tauri::utils::config::Color(24, 24, 24, 255))
            .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
            .build()?;
        let alignment = Arc::new(Mutex::new((0usize, 0u8, true)));
        let report = alignment.clone();
        let monitor = app.handle().clone();
        app.listen("theme-probe-color", move |event| {
            let Ok(value) = serde_json::from_str::<serde_json::Value>(event.payload()) else {return};
            let Some(rgb) = value["rgb"].as_array() else {return};
            if rgb.len() != 3 {return;}
            let expected: Vec<u8> = rgb.iter().map(|v| v.as_u64().unwrap_or(0) as u8).collect();
            let text: Vec<u8> = value["text"].as_array().unwrap().iter().map(|v|v.as_u64().unwrap_or(0) as u8).collect();
            let readable = text == [236,236,238] || text == [36,36,38];
            let no_snapshot = value["snapshots"].as_u64() == Some(0);
            let app = monitor.clone(); let report = report.clone();
            monitor.run_on_main_thread(move || {
                let window=app.get_webview_window("main").unwrap();
                let native=unsafe {&*window.ns_window().unwrap().cast::<NSWindow>()};
                let color=native.backgroundColor();
                let actual=[color.redComponent(),color.greenComponent(),color.blueComponent()].map(|v|(v*255.0).round() as u8);
                let delta=actual.iter().zip(expected).map(|(a,b)|a.abs_diff(b)).max().unwrap();
                let mut stats=report.lock().unwrap(); stats.0+=1; stats.1=stats.1.max(delta); stats.2 &= readable && no_snapshot;
            }).unwrap();
        });
        let handle = app.handle().clone();
        let colors = Arc::new(Mutex::new(Vec::new()));
        std::thread::spawn(move || {
            for index in 0..250 {
                std::thread::sleep(Duration::from_millis(20));
                let app = handle.clone();
                let samples = colors.clone();
                let alignment = alignment.clone();
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
                        let stats = alignment.lock().unwrap();
                        println!("DOM/native alignment: {} frames, max RGB delta={}, readable text without snapshots={}", stats.0,stats.1,stats.2);
                        let passed = unique.len() > 5 && light && dark && stats.0 > 10 && stats.1 <= 8 && stats.2;
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
