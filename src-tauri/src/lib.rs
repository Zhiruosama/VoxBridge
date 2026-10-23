mod asr;
mod audio;
mod capture;
mod credentials;
#[cfg(test)]
mod live_tests;
#[cfg(any(target_os = "macos", test))]
mod pcm;
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
        native_capture: cfg!(target_os = "macos"),
        message: "工作台开发版 · 支持文字翻译、语音合成、Qwen HTTP 短音频识别及 Mac 目标进程采集诊断。实时采集识别链路、实际权限和声音路由待验证。",
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(providers::Requests::default())
        .manage(audio::ToneState::default())
        .manage(capture::CaptureState::default())
        .manage(asr::AsrState::default())
        .manage(speech::SpeechState::default())
        .manage(speech::AudioGate::new())
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            credentials::credential_status,
            credentials::set_credential,
            credentials::remove_credential,
            providers::translate,
            providers::cancel_translation,
            asr::transcribe_wav,
            asr::stop_asr,
            audio::list_outputs,
            audio::test_tone,
            audio::stop_tone,
            capture::list_capture_sources,
            capture::capture_diagnostic,
            capture::stop_capture,
            speech::speak,
            speech::stop_speech,
        ])
        .build(tauri::generate_context!())
        .expect("VoxBridge desktop runtime failed")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                use tauri::Manager;
                app.state::<capture::CaptureState>().stop_all();
                app.state::<asr::AsrState>().stop_all();
            }
        });
}
