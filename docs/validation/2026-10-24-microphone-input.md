# Microphone voice input

[验证索引](README.md) · [当前使用指南](../user-guide.md)

> 历史验证记录：仅说明记录日期的测试范围，不代表所有平台、客户端或后续构建均通过。

## Behavior

- Composer microphone entry has two persisted modes. Default: **语音转文字**. Click to start, click **完成录音**, then edit/send the recognized draft. **语音消息** automatically passes the recognized text through the existing target-language detection, translation, TTS, output routing and monitoring pipeline after capture stops.
- Physical input selection is under Settings → General → Audio. Empty selection follows the system default without changing it. Stable CPAL device IDs survive reorder; disconnected selections remain visible and produce an actionable error. VoxBridge's own virtual microphone is excluded/rejected to prevent self-capture.
- Explicit macOS AVCaptureDevice authorization is requested only by starting voice input. Device enumeration and permission-state queries do not request authorization. Existing usage description is reused.
- Native capture downmixes to mono, resamples to 16 kHz PCM16 and flushes the resampler tail. A lock-free ring separates the real-time audio callback from network/UI work. Recordings are bounded to 30 seconds and held only in memory.
- Qwen WebSocket audio streams while recording; completion drains the provider's final result. Qwen HTTP sends the bounded WAV after recording. ASR is independent of application listening. Both use the selected ASR profile and native credential store.
- Cancel aborts capture/ASR. Cancel-before-start is remembered in a bounded registry. Finish closes recording without cancelling final ASR. Stale operation IDs cannot stop a newer recording. Exit stops recording. Silence, disconnected devices, overflow, stalled input and transport errors do not auto-send.
- The composer stays editable during capture. If the draft changed, transcription is appended and auto-send is suppressed until manual confirmation. Existing send clearing, failure restoration and next-draft protection are reused. Target/output/mode controls lock during recording; late recording progress cannot undo the finishing state.

## Validation

- Frontend suite: 109 tests passed, including default-mode migration and microphone/mode persistence. Production TypeScript/Vite build and formatting passed.
- Native suite: 125 tests passed (22 manual tests ignored). The microphone suite also passed with its read-only device-enumeration test explicitly enabled. No physical microphone stream was opened by tests.
- Native Clippy (`--all-targets --locked -- -D warnings`) and formatting passed.
- Read-only native enumeration found input devices and excluded VoxBridge. The linked AVFoundation permission API returned a valid authorization state without asking for permission.
- Browser UI with **simulated microphone/ASR/TTS**, using the actual App and IPC bridge: default dictation fills the composer without translation/output; recording cancellation preserves the draft; editing during capture preserves typed text and appends transcription; voice-message mode translates, displays bilingual text and clears accepted input; typing the next draft during output is preserved. Settings input dropdown includes system default and explicit microphones.
- macOS `.app` packaged and code signature checked. Actual spoken microphone capture, the first macOS permission interaction and live microphone-to-Discord delivery remain user acceptance checks; no user background audio was recorded for this validation.

Implementation references: [Apple media-capture authorization](https://developer.apple.com/documentation/bundleresources/requesting-authorization-for-media-capture-on-macos), [CPAL](https://github.com/RustAudio/cpal).
