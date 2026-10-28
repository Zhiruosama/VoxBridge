//! Real, disposable nonactivating panel. No credentials, clipboard or model calls.
#[cfg(target_os = "macos")]
#[path = "../src/overlay/panel.rs"]
mod panel;
#[cfg(target_os = "macos")]
#[path = "../src/overlay/resize.rs"]
mod resize;
#[cfg(target_os = "macos")]
fn subtitle_collection_behavior(
    value: objc2_app_kit::NSWindowCollectionBehavior,
) -> objc2_app_kit::NSWindowCollectionBehavior {
    use objc2_app_kit::NSWindowCollectionBehavior as B;
    value | B::CanJoinAllSpaces | B::FullScreenAuxiliary | B::CanJoinAllApplications
}
#[cfg(target_os = "macos")]
#[tauri::command]
async fn set_overlay_text_input(window: tauri::WebviewWindow, active: bool) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(panel::text_input("subtitle", active));
        })
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|e| e.to_string())?
}
#[cfg(target_os = "macos")]
#[tauri::command]
fn finish_ime_probe(app: tauri::AppHandle) {
    app.exit(0);
}
#[cfg(target_os = "macos")]
fn main() {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.voxbridge.overlay-ime-regression".into();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            set_overlay_text_input,
            finish_ime_probe
        ])
        .setup(|app| {
            let host = WebviewWindowBuilder::new(
                app,
                "subtitle",
                WebviewUrl::External(
                    "http://127.0.0.1:1420/src-tauri/examples/overlay-ime-regression.html"
                        .parse()?,
                ),
            )
            .visible(false)
            .title("VoxBridge Input Method Test")
            .inner_size(700.0, 380.0)
            .build()?;
            panel::prepare(&host, true).map_err(std::io::Error::other)?;
            // Exit even if the tester forgets to close the floating panel.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(180));
                handle.exit(0);
            });
            Ok(())
        })
        .run(context)
        .expect("IME panel regression failed");
}
#[cfg(not(target_os = "macos"))]
fn main() {
    println!("macOS-only input method regression");
}
