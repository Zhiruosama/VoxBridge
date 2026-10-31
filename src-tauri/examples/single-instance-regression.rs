//! Isolated process/IPC regression. No settings, credentials, tray or audio.
#[path = "../src/window_behavior.rs"]
mod window_behavior;
use tauri::Manager;

fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.voxbridge.single-instance-regression".into();
    let maintenance = std::env::args().any(|arg| arg == "--maintenance-probe");
    let mut builder = tauri::Builder::default();
    if !maintenance {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            window_behavior::show_main(app).unwrap();
            assert!(app
                .get_webview_window("main")
                .unwrap()
                .is_visible()
                .unwrap());
            println!("PASS: secondary process woke existing hidden window");
            app.exit(0);
        }));
    }
    builder
        .setup(move |app| {
            if maintenance {
                println!("PASS: maintenance process starts alongside primary");
                app.handle().exit(0);
                return Ok(());
            }
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External("about:blank".parse()?),
            )
            .title("VoxBridge single-instance isolated test")
            .visible(false)
            .build()?;
            let app = app.handle().clone();
            std::thread::spawn(move || {
                let executable = std::env::current_exe().unwrap();
                let status = std::process::Command::new(&executable)
                    .arg("--maintenance-probe")
                    .status()
                    .unwrap();
                assert!(status.success());
                let status = std::process::Command::new(executable).status().unwrap();
                assert!(status.success());
                std::thread::sleep(std::time::Duration::from_secs(10));
                app.exit(2); // callback must have exited the primary before timeout
            });
            Ok(())
        })
        .run(context)
        .expect("single-instance regression");
}
