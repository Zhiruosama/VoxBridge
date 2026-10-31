//! Persistent recovery and explicit quit for the Windows background window.
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

pub fn show_main(app: &tauri::AppHandle) -> tauri::Result<()> {
    crate::window_behavior::show_main(app)
}

pub fn initialize(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(
        app,
        "voxbridge-open",
        "打开 VoxBridge / Open",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        app,
        "voxbridge-quit",
        "退出 VoxBridge / Quit",
        true,
        None::<&str>,
    )?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    // Windows examples/hosts may expose only a PE icon, with no default Image.
    // Embed the tray asset explicitly so recovery never depends on that lookup.
    let icon = tauri::include_image!("icons/32x32.png");
    TrayIconBuilder::with_id("voxbridge-main")
        .icon(icon)
        .tooltip("VoxBridge")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                let _ = show_main(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "voxbridge-open" => {
                let _ = show_main(app);
            }
            // Bypasses X/hide and reaches the normal RunEvent task cleanup.
            "voxbridge-quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    app.state::<crate::window_behavior::WindowBehavior>()
        .enable_tray();
    Ok(())
}
