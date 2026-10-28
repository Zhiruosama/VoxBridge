//! Disposable main-window test: no settings, credentials or audio.
#[cfg(target_os = "macos")]
#[path = "../src/window_geometry.rs"]
mod geometry;
#[cfg(target_os = "macos")]
#[tauri::command(rename = "zoom_main_window")]
async fn zoom_probe(window: tauri::WebviewWindow, check: Option<bool>) -> Result<String, String> {
    if check.unwrap_or(false) {
        let (tx, rx) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                #[cfg(debug_assertions)]
                let _ = tx.send(geometry::regression("main"));
                #[cfg(not(debug_assertions))]
                let _ = tx.send(Err("debug only".into()));
            })
            .map_err(|e| e.to_string())?;
        return rx.await.map_err(|e| e.to_string())?;
    }
    geometry::zoom_main_window(window)
        .await
        .map(|_| "缩放完成".into())
}
#[cfg(target_os = "macos")]
fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.voxbridge.main-zoom-regression".into();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![zoom_probe])
        .setup(|app| {
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(
                    "http://127.0.0.1:1420/src-tauri/examples/main-zoom-regression.html".parse()?,
                ),
            )
            .title("VoxBridge Zoom Test")
            .inner_size(1050.0, 700.0)
            .decorations(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(12.0, 18.0))
            .build()?;
            geometry::install(&window)?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(600));
                handle.exit(0);
            });
            Ok(())
        })
        .run(context)
        .expect("zoom regression");
}
#[cfg(not(target_os = "macos"))]
fn main() {}
