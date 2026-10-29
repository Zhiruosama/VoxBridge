//! Isolated updater UI preview. Never runs an installer or reads user settings.
#[tauri::command]
fn setup_inspect() -> serde_json::Value {
    serde_json::json!({"language":"zh"})
}

#[tauri::command]
async fn setup_update() -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_secs(30));
    })
    .await
    .unwrap();
    serde_json::json!({"restarted":true})
}

#[tauri::command]
fn setup_finish(open: bool) {
    assert!(!open, "Preview must never open the installed app");
    println!("PASS: update UI completed; no installer or installed app was launched");
}

fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.voxbridge.update-ui-regression".into();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            setup_inspect,
            setup_update,
            setup_finish
        ])
        .setup(|app| {
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "setup",
                tauri::WebviewUrl::App("index.html?window=setup&mode=update".into()),
            )
            .title("VoxBridge 更新 · 独立预览")
            .inner_size(900.0, 640.0)
            .min_inner_size(820.0, 580.0)
            .decorations(false)
            .background_color(tauri::window::Color(30, 30, 30, 255));
            #[cfg(target_os = "windows")]
            let window = window
                .data_directory(std::env::temp_dir().join("VoxBridgeUpdateUiPreview-Webview"));
            window.build()?;
            Ok(())
        })
        .run(context)
        .expect("updater UI preview");
}
