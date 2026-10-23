# Application selection for listening

The main workspace and audio diagnostics now list open applications by their localized names instead of audio PIDs. The list loads automatically and refreshes when opened; an empty list explains that an application must be opened first. Selecting an application does not launch it or start capture.

On macOS, application identity is the outer `.app` bundle's identifier. Audio helpers nested inside Chrome or WeChat resolve to their owning application. A selected application's registered Core Audio process objects are mixed into one inclusive tap; other applications are excluded. A process target without app scope retains exact PID/bundle matching for existing diagnostics and controlled fixtures.

Selection keys use bundle identity, surviving application PID changes. The capture owner compares the current process-object set with its initial set; changes trigger the existing bounded recovery path, which enumerates the selected application again before creating a fresh tap. A selected app without an audio process enters the same bounded retry path and asks the user to play sound. Capture remains explicit and permission checks are unchanged.

## Validation

- Frontend: 76 tests passed, including stable application keys across PID changes and legacy process identity.
- Rust: 73 tests passed, 15 manual/service/hardware tests ignored. New tests cover nested helper ownership and recovery without crossing application/process scopes.
- Clippy with warnings denied, Rust formatting, frontend formatting, production frontend build and diff checks passed.
- Explicit read-only macOS inventory test: 16 open applications, including WeChat; Chrome was not running at that check. Entries were unique by bundle ID and had names; matched Core Audio object owners were checked against the selected bundle. No taps or audio streams were opened by this test.
- Isolated mocked desktop UI: Google Chrome and 微信 options displayed without PIDs; selecting Chrome enabled Start Listening; refreshing on menu open remained usable; an empty list showed a disabled explanatory row.
- UI screenshot: `native/macos/.build/application-picker.png` (ignored artifact).
- This batch did not run real ASR/TTS, capture live conversation audio, or access credentials. Actual Chrome/WeChat playback through the new grouped tap still needs interactive acceptance. The existing running app was not restarted, preserving session credentials.
