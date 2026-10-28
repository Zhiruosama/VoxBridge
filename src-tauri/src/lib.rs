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
mod setup;
mod speech;
mod text_overlay;
#[cfg(all(test, target_os = "windows"))]
mod update_tests;
mod window_behavior;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    platform: &'static str,
    native_capture: bool,
    message: &'static str,
}

#[tauri::command]
fn runtime_info() -> RuntimeInfo {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let native_capture = capture::native::supported().is_ok();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let native_capture = false;
    RuntimeInfo {
        platform: std::env::consts::OS,
        native_capture,
        message: "支持应用声音采集、实时识别与双语字幕；设备和权限状态以实际诊断为准。",
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            if setup::create_window(app)? {
                return Ok(());
            }
            // Diagnostics must never prevent the application from starting.
            let _ = diagnostics::initialize(app.handle());
            credentials::initialize(app.handle()).map_err(std::io::Error::other)?;
            // Configure the Windows frame before showing the first native frame.
            // macOS retains native traffic lights above a WebView-painted header.
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .ok_or_else(|| std::io::Error::other("Main window configuration is missing"))?;
            let builder = tauri::WebviewWindowBuilder::from_config(app, config)?;
            #[cfg(target_os = "windows")]
            let builder = builder.decorations(false);
            // Let one compositor paint the header and page transition. Native
            // traffic lights remain over the WebView, with a reserved DOM row;
            // an independently painted AppKit background can lag a DOM frame.
            #[cfg(target_os = "macos")]
            let builder = builder
                .decorations(true)
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                // Tao treats Y as extra titlebar-container height, not a
                // top margin. 10 places the controls against the top edge.
                .traffic_light_position(tauri::LogicalPosition::new(12.0, 18.0))
                // The main WebView owns queue scheduling and listening state.
                // Hiding/minimizing must not suspend those tasks after a few minutes.
                .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled);
            builder.build()?;
            for config in app
                .config()
                .app
                .windows
                .iter()
                .filter(|w| matches!(w.label.as_str(), "subtitle" | "text-overlay"))
            {
                tauri::WebviewWindowBuilder::from_config(app, config)?.build()?;
            }
            Ok(())
        })
        .manage(providers::Requests::default())
        .manage(audio::ToneState::default())
        .manage(capture::CaptureState::default())
        .manage(asr::AsrState::default())
        .manage(microphone::MicrophoneState::default())
        .manage(overlay::OverlayState::default())
        .manage(text_overlay::TextOverlayState::default())
        .manage(overlay::voice::OverlayVoiceState::default())
        .manage(speech::SpeechState::default())
        .manage(speech::PreparedSpeechState::default())
        .manage(speech::AudioGate::new())
        .manage(setup::SetupState::default())
        .manage(window_behavior::WindowBehavior::default())
        .invoke_handler(tauri::generate_handler![
            setup::setup_inspect,
            setup::setup_choose_folder,
            setup::setup_install,
            setup::setup_finish,
            runtime_info,
            window_behavior::set_main_close_behavior,
            diagnostics::record_diagnostic,
            diagnostics::open_diagnostics_folder,
            diagnostics::export_diagnostics,
            microphone::list_inputs,
            microphone::microphone_access,
            platform::virtual_mic::open_audio_settings,
            microphone::start_voice_input,
            microphone::finish_voice_input,
            microphone::cancel_voice_input,
            language::detect_text_language,
            text_overlay::publish_text_overlay,
            text_overlay::read_text_overlay,
            text_overlay::show_text_overlay,
            text_overlay::hide_text_overlay,
            text_overlay::text_overlay_action,
            overlay::publish_overlay,
            overlay::read_overlay,
            overlay::voice::read_overlay_voice,
            overlay::voice::publish_overlay_voice,
            overlay::voice::overlay_voice_action,
            overlay::show_overlay,
            overlay::hide_overlay,
            overlay::drag_overlay,
            overlay::resize_overlay,
            overlay::set_overlay_text_input,
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
            audio::inspect_speech_output,
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
            platform::virtual_mic::virtual_mic_status,
            platform::virtual_mic::open_virtual_mic_vendor,
        ])
        .on_window_event(|window, event| {
            use tauri::Manager;
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if matches!(window.label(), "subtitle" | "text-overlay") {
                    api.prevent_close();
                    let _ = window.hide();
                } else if window.label() == "main" {
                    if window
                        .app_handle()
                        .state::<window_behavior::WindowBehavior>()
                        .should_hide(std::env::consts::OS, window.label())
                    {
                        api.prevent_close();
                        let _ = window.hide();
                        return;
                    }
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
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                use tauri::Manager;
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main
                        .show()
                        .and_then(|_| main.unminimize())
                        .and_then(|_| main.set_focus());
                }
            }
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
