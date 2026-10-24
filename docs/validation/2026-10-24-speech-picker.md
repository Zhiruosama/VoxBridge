# Speech presets and switching voices while listening

- A compact voice-name control in the composer opens provider/profile, synthesis model and voice selectors. Changes persist immediately, retain the profile ID used by credential storage, and apply to subsequent synthesis. ComposerController already clones settings at operation start, so current synthesis/translation keeps its original configuration.
- Existing ASR capture is independent and is neither stopped nor restarted. The quick menu's More settings opens the TTS page without stopping capture. Other settings continue using their existing stop-before-edit behavior. This change does not introduce live ASR model switching or additional ASR protocols.
- Settings model presets follow the implemented protocol: Qwen task WebSocket uses qwen-audio-3.0-asr-flash-streaming; Qwen HTTP uses qwen3-asr-flash. Unsupported Realtime API variants are deliberately absent. Existing manual model IDs are preserved.
- MiniMax synthesis offers Speech 2.8 turbo/HD and a curated language-grouped voice list. OpenAI's own endpoint has a separate model/voice catalog and a new public connection preset. OpenAI-compatible third-party endpoints retain their own IDs rather than inheriting OpenAI's catalog. Switching a known modern OpenAI voice to a legacy model selects alloy; custom IDs remain user-controlled. MiniMax custom/cloned IDs remain available alongside presets.
- Shared Select supports optional labeled groups with existing keyboard navigation and menu behavior. No keys enter the catalogs or settings JSON, and selecting public choices does not read/copy/reassign credentials.

## Validation

- 117 frontend tests passed, including provider separation, legacy voice compatibility, protocol-specific ASR models, custom IDs, immutable updates and persistence. Formatting and production build passed.
- UI uses real App/bridge components with simulated providers, not live audio or paid API calls. Started capture once, selected English_CalmWoman and speech-2.8-hd, then sent a message. The mocked synthesis request contained both new IDs while capture counters remained starts=1, stops=0. More settings opened the TTS page with the same counters and captions. Reload retained the voice/model. Screenshot: ignored local native/macos/.build/speech-picker-ui.png.
- Signed macOS app built and microphone entitlement verification passed. The user's running app was not interrupted; restart is needed to load the packaged UI.

## Catalog references (checked 2026-10-24)

- MiniMax: https://platform.minimax.io/docs/faq/system-voice-id and https://github.com/MiniMax-AI/skills/blob/main/skills/frontend-dev/references/minimax-voice-catalog.md
- OpenAI: https://developers.openai.com/api/docs/guides/text-to-speech
- Qwen: https://help.aliyun.com/zh/model-studio/qwen-audio-3-0-asr-flash-streaming and https://help.aliyun.com/zh/model-studio/asr-model/

Availability can depend on provider accounts, endpoints and model permissions. Catalog validation is not a live-provider acceptance test for every voice.
