//! Disposable native tray/window probe. No real settings, audio or credentials.
#[cfg(target_os = "windows")]
#[path = "../src/window_behavior.rs"]
mod window_behavior;
#[cfg(target_os = "windows")]
#[path = "../src/windows_tray.rs"]
mod windows_tray;

#[cfg(target_os = "windows")]
fn main() {
    use tauri::Manager;
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.voxbridge.tray-regression".into();
    tauri::Builder::default()
        .manage(window_behavior::WindowBehavior::default())
        .setup(|app| {
            let window = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External("about:blank".parse()?))
                .title("VoxBridge Tray Regression")
                .data_directory(std::env::temp_dir().join(format!("VoxBridgeTrayTest-{}", std::process::id())))
                .visible(false).build()?;
            windows_tray::initialize(app.handle())?;
            assert!(app.tray_by_id("voxbridge-main").is_some());
            let policy = app.state::<window_behavior::WindowBehavior>();
            assert!(policy.should_hide("windows", "main"));
            assert!(!policy.should_minimize("windows", "main"));
            assert!(!window.is_visible()?);
            windows_tray::show_main(app.handle())?;
            assert!(window.is_visible()?);
            assert!(!window.is_minimized()?);
            window.hide()?;
            assert!(!window.is_visible()?);
            assert!(app.tray_by_id("voxbridge-main").is_some());
            println!("PASS: real Windows tray registered; hidden window retains tray; restore shows and unminimizes main; no user profile or audio access");
            app.handle().exit(0);
            Ok(())
        })
        .run(context).expect("Windows tray regression failed");
}

#[cfg(not(target_os = "windows"))]
fn main() {
    println!("Windows-only tray regression");
}
