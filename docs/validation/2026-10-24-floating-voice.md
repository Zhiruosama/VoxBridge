# Voice input from floating captions

[验证索引](README.md) · [当前使用指南](../user-guide.md)

> 历史验证记录：仅说明记录日期的测试范围，不代表所有平台、客户端或后续构建均通过。

## Behavior

- A microphone button sits at the subtitle panel's bottom-right. Click to start recording; click the square to finish. Volume animation, recognition/output status, cancellation and output stopping are available in the panel.
- The existing direct-send preference applies. Enabled: recognize, translate as needed and synthesize automatically. Disabled: retain the transcription in an editable floating draft, then explicitly generate/send it. Output failures and stopped output keep the floating draft for retry.
- Uses the existing physical microphone selection, ASR profile, target language, translation prompt, output mode, routing and monitoring. The existing one-minute recording limit applies.
- Floating messages are independent of the main composer's unsent text. They neither concatenate, clear nor restore over that draft. The shared composer/microphone locks prevent concurrent conflicting jobs; main and floating controls reflect the same operation.
- The subtitle renderer receives a bounded, versioned status snapshot and can issue a small typed set of voice actions. Recording, keys, translation and synthesis remain owned by the main workspace/backend. No direct credential, provider or microphone IPC permission is granted to the subtitle window.
- Voice progress uses a separate lightweight event, avoiding retransmission of the caption history for every volume update. Stale snapshots cannot roll back progress. Floating recording is disabled while the main workspace is editing settings, preventing use of unsaved configuration.

## Validation

- Frontend suite: 111 passed. Includes stale progress/read ordering coverage.
- Native suite: 131 passed, 22 manual tests ignored. New tests cover subtitle-only voice actions, bounded send text, unknown/invalid progress and oversized state; existing capability tests prohibit credential/network/provider/publish access from the subtitle window.
- Production TypeScript/Vite and macOS app builds passed, as did Clippy with warnings denied, Rust/frontend formatting and signed microphone-entitlement verification.
- UI harness uses the actual App, SubtitleOverlay and IPC bridge with a shared simulated event bus and simulated microphone/providers. Tested editable dictation, edited text → translation/TTS, direct send, cancellation, stopping output, failure retention, and main-draft preservation. After a successful floating send, the main draft remained byte-for-byte unchanged and the floating draft cleared.
- Restarted the native production app while no recording/output was active; opened the native panel and confirmed its bottom-right microphone is enabled and has the configured target language. This verifies the real read/publish event and capability path. Left the panel open for the user.
- No real microphone recording or provider request was started during this validation. Actual spoken recording and remote Discord reception remain user acceptance checks through the existing audio pipeline.
