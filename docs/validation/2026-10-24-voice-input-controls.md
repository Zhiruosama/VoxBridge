# Voice input controls and one-minute recordings

- Replaced the microphone mode dropdown with a persisted **直接发送** switch. Off by default: finish recording, review/edit transcription in the composer, then send. On: finish recording, recognize, translate if needed and synthesize to the configured route. Existing `voiceInputMode` settings migrate without losing the choice.
- Replaced the elapsed/limit counter with seven animated bars and a recording/processing label. Native capture emits RMS-derived volume at 20 Hz; bar heights follow volume and have staggered animation. System reduced-motion preferences disable animation/transitions.
- Raised both capture duration and bounded PCM storage to 60 seconds (960,000 mono PCM16 samples). Capture automatically finishes at the limit. Cancellation, draft revision protection and independent incoming listening remain intact.
- The HTTP short-audio adapter retains its existing 30-second/1 MB validation. Longer microphone messages split near low-energy windows around 26–28 seconds, with no overlap or lost samples; individual transcriptions are joined before editing or output. A short tail is retained in the preceding segment. WebSocket capture streams continuously.
- Raised composer and native TTS text limits to 2,000 characters so normal one-minute transcripts above the former 500-character bound can be edited and sent. Translation already supports 2,000 characters. Over-limit translation remains visible and is not sent to TTS.

## Validation

- Frontend: 110 tests passed, including an 800-character draft and longer translated output, plus the 2,000-character guard.
- Native: 128 tests passed (22 manual tests ignored). New tests cover a full minute through HTTP splitting/WAV validation, contiguous coverage with short tails, quiet-boundary selection, and silent/invalid/variable audio meter levels.
- Native Clippy with warnings denied; TypeScript/Vite build; frontend and Rust formatting.
- Actual App UI with simulated microphone/ASR/TTS: default switch off; seven animated bars using volume 0.75; no seconds counter even at simulated 43 seconds; transcription goes into composer; switch on auto-sends; a next draft survives playback; edits during recording suppress auto-send and preserve both typed and recognized content.
- Packaged macOS application passes the signed-artifact microphone entitlement check. No user background audio was recorded. Live microphone/provider and Discord sound quality remain user acceptance checks.

[MiniMax WebSocket speech API](https://platform.minimax.io/docs/api-reference/speech-t2a-websocket).
