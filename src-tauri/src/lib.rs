mod asr;
mod audio;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod audio_pipeline;
mod capture;
mod credentials;
mod diagnostics;
mod language;
#[cfg(test)]
mod live_tests;
mod microphone;
mod overlay;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod pcm;
mod platform;
mod providers;
mod recovery;
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
        message: "工作台开发版 · 支持 Mac 目标进程 HTTP 分段识别与双语字幕。实时 WebSocket、真实采集权限、延迟和声音路由仍待验收。",
    }
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Diagnostics must never prevent the application from starting.
            let _ = diagnostics::initialize(app.handle());
            credentials::initialize(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .manage(providers::Requests::default())
        .manage(audio::ToneState::default())
        .manage(capture::CaptureState::default())
        .manage(asr::AsrState::default())
        .manage(microphone::MicrophoneState::default())
        .manage(overlay::OverlayState::default())
        .manage(overlay::voice::OverlayVoiceState::default())
        .manage(speech::SpeechState::default())
        .manage(speech::PreparedSpeechState::default())
        .manage(speech::AudioGate::new())
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            diagnostics::record_diagnostic,
            diagnostics::open_diagnostics_folder,
            diagnostics::export_diagnostics,
            microphone::list_inputs,
            microphone::start_voice_input,
            microphone::finish_voice_input,
            microphone::cancel_voice_input,
            language::detect_text_language,
            overlay::publish_overlay,
            overlay::read_overlay,
            overlay::voice::read_overlay_voice,
            overlay::voice::publish_overlay_voice,
            overlay::voice::overlay_voice_action,
            overlay::show_overlay,
            overlay::hide_overlay,
            overlay::drag_overlay,
            overlay::focus_main,
            overlay::stop_overlay_listening,
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
            capture::finish_listening,
            capture::listening::start_listening,
            speech::speak,
            speech::prepared::prepare_speech,
            speech::prepared::play_prepared_speech,
            speech::prepared::discard_prepared_speech,
            speech::stop_speech,
            speech::set_speech_monitoring,
            platform::open_virtual_mic_installer,
        ])
        .on_window_event(|window, event| {
            use tauri::Manager;
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "subtitle" {
                    api.prevent_close();
                    let _ = window.hide();
                } else if window.label() == "main" {
                    window
                        .app_handle()
                        .state::<capture::CaptureState>()
                        .stop_all();
                    window.app_handle().state::<asr::AsrState>().stop_all();
                    window
                        .app_handle()
                        .state::<microphone::MicrophoneState>()
                        .stop_all();
                    window
                        .app_handle()
                        .state::<providers::Requests>()
                        .stop_all();
                    window
                        .app_handle()
                        .state::<speech::SpeechState>()
                        .stop_all();
                    window.app_handle().exit(0);
                }
            }
        })
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
                app.state::<microphone::MicrophoneState>().stop_all();
                app.state::<providers::Requests>().stop_all();
                app.state::<speech::SpeechState>().stop_all();
                app.state::<speech::PreparedSpeechState>().stop_all();
                diagnostics::lifecycle("shutdown");
                let _ = diagnostics::flush();
                credentials::clear_session();
                app.state::<audio::ToneState>()
                    .0
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
        });
}
