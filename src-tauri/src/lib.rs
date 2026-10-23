mod audio;
mod credentials;
#[cfg(test)]
mod live_tests;
mod platform;
mod providers;
mod speech;

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
        message: "工作台开发版 · 支持文字翻译、语音合成及指定设备输出。服务可用性取决于当前配置，macOS 采集与音频路由待实机验证。",
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(providers::Requests::default())
        .manage(audio::ToneState::default())
        .manage(speech::SpeechState::default())
        .manage(speech::AudioGate::new())
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
            speech::speak,
            speech::stop_speech,
        ])
        .run(tauri::generate_context!())
        .expect("VoxBridge desktop runtime failed");
}
