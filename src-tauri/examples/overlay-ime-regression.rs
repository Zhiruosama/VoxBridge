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
async fn set_overlay_text_input(
    window: tauri::WebviewWindow,
    active: bool,
    test_action: Option<String>,
) -> Result<String, String> {
    if let Some(action) = test_action {
        if action == "finish" {
            std::process::exit(0);
        }
        return select_test_input(window, action == "pinyin").await;
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(panel::text_input("subtitle", active));
        })
        .map_err(|e| e.to_string())?;
    rx.await
        .map_err(|e| e.to_string())?
        .map(|_| "输入已准备".into())
}
#[cfg(target_os = "macos")]
async fn select_test_input(window: tauri::WebviewWindow, chinese: bool) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let _ = panel::text_input("subtitle", true);
            use std::ffi::c_void;
            #[link(name = "Carbon", kind = "framework")]
            unsafe extern "C" {
                static kTISPropertyInputSourceID: *const c_void;
                fn TISCreateInputSourceList(filter: *const c_void, all: u8) -> *const c_void;
                fn TISGetInputSourceProperty(
                    source: *const c_void,
                    key: *const c_void,
                ) -> *const c_void;
                fn TISSelectInputSource(source: *const c_void) -> i32;
            }
            #[link(name = "CoreFoundation", kind = "framework")]
            unsafe extern "C" {
                fn CFArrayGetCount(array: *const c_void) -> isize;
                fn CFArrayGetValueAtIndex(array: *const c_void, index: isize) -> *const c_void;
                fn CFEqual(a: *const c_void, b: *const c_void) -> u8;
                fn CFRelease(value: *const c_void);
            }
            // Explicit, visible test control; never invoked by the production app.
            let id = objc2_foundation::NSString::from_str(if chinese {
                "com.apple.inputmethod.SCIM.ITABC"
            } else {
                "com.apple.keylayout.ABC"
            });
            let mut result = "找不到输入法".to_string();
            unsafe {
                let sources = TISCreateInputSourceList(std::ptr::null(), 0);
                if !sources.is_null() {
                    for index in 0..CFArrayGetCount(sources) {
                        let source = CFArrayGetValueAtIndex(sources, index);
                        let value = TISGetInputSourceProperty(source, kTISPropertyInputSourceID);
                        if !value.is_null()
                            && CFEqual(value, &*id as *const _ as *const c_void) != 0
                        {
                            result = format!("输入法选择状态：{}", TISSelectInputSource(source));
                            break;
                        }
                    }
                    CFRelease(sources);
                }
            }
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|e| e.to_string())
}
#[cfg(target_os = "macos")]
fn main() {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.voxbridge.overlay-ime-regression".into();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_overlay_text_input,])
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
            if std::env::args().any(|arg| arg == "--self-check") {
                #[cfg(debug_assertions)]
                panel::regression::run(&host).map_err(std::io::Error::other)?;
                app.handle().exit(0);
                return Ok(());
            }
            panel::prepare(&host, true).map_err(std::io::Error::other)?;
            // Exit even if the tester forgets to close the floating panel.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(600));
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
