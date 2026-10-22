mod audio;
mod credentials;
mod providers;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    platform: &'static str,
    native_capture: bool,
    message: &'static str,
}

#[tauri::command]
fn runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        platform: std::env::consts::OS,
        native_capture: false,
        message: "工作台开发版 · 支持服务配置、文字翻译和输出测试。系统声音识别与 TTS 仍在接入，macOS 原生采集待实机验证。",
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(providers::Requests::default())
        .manage(audio::ToneState::default())
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            credentials::credential_status,
            credentials::set_credential,
            credentials::remove_credential,
            providers::translate,
            providers::cancel_translation,
            audio::list_outputs,
            audio::test_tone,
            audio::stop_tone,
        ])
        .run(tauri::generate_context!())
        .expect("VoxBridge desktop runtime failed");
}
