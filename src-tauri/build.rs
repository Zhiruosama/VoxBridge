fn main() {
    // Public builds embed null; private values remain in ignored build output.
    println!("cargo:rerun-if-env-changed=VOXBRIDGE_PRIVATE_PRESET");
    let preset =
        std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("private-preset.json");
    if let Some(source) = std::env::var_os("VOXBRIDGE_PRIVATE_PRESET") {
        assert!(
            std::env::var_os("CI").is_none(),
            "Private presets are local builds only"
        );
        println!(
            "cargo:rerun-if-changed={}",
            std::path::Path::new(&source).display()
        );
        std::fs::copy(source, preset).expect("Unable to stage private preset");
    } else {
        std::fs::write(preset, b"null").expect("Unable to stage empty preset");
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // Tauri embeds its Windows manifest in the application binary only.
        // Native GUI regression examples also need Common Controls v6 before
        // the loader can resolve Tao's TaskDialogIndirect import.
        println!("cargo:rustc-link-arg-examples=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-examples=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "setup_inspect",
            "setup_choose_folder",
            "setup_install",
            "setup_finish",
            "setup_uninstall",
            "runtime_info",
            "private_preset",
            "set_main_close_behavior",
            "zoom_main_window",
            "record_diagnostic",
            "open_diagnostics_folder",
            "export_diagnostics",
            "list_inputs",
            "microphone_access",
            "open_audio_settings",
            "start_voice_input",
            "finish_voice_input",
            "cancel_voice_input",
            "credential_status",
            "set_credential",
            "remove_credential",
            "translate",
            "detect_text_language",
            "cancel_translation",
            "transcribe_wav",
            "stop_asr",
            "list_outputs",
            "inspect_speech_output",
            "test_tone",
            "stop_tone",
            "list_capture_sources",
            "capture_diagnostic",
            "stop_capture",
            "finish_listening",
            "start_listening",
            "speak",
            "prepare_speech",
            "play_prepared_speech",
            "discard_prepared_speech",
            "stop_speech",
            "set_speech_monitoring",
            "open_virtual_mic_installer",
            "virtual_mic_status",
            "open_virtual_mic_vendor",
            "publish_text_overlay",
            "read_text_overlay",
            "show_text_overlay",
            "hide_text_overlay",
            "text_overlay_action",
            "publish_overlay",
            "read_overlay",
            "read_overlay_voice",
            "publish_overlay_voice",
            "overlay_voice_action",
            "show_overlay",
            "hide_overlay",
            "drag_overlay",
            "resize_overlay",
            "set_overlay_text_input",
            "focus_main",
            "stop_overlay_listening",
        ]),
    ))
    .expect("Tauri build failed");
}
