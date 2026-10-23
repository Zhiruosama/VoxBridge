# Composer subtitles and stable input layout

- Removed the translation result panel and its duplicate playback/send buttons below the composer.
- Expression translations now append an immutable original/translation pair to the shared subtitle feed. The active listening session ID and audio revision guards remain intact; expression IDs use a separate namespace and share the 500-entry history limit.
- Kept the composer at the bottom with a fixed-height, internally scrolling text input. Composer errors use the existing toast instead of adding layout height.
- Translation history survives input edits and configuration changes, as completed captions do. Starting a new listening session still starts a new subtitle feed.

## Validation

- Frontend: 74 tests passed, including expression/audio coexistence, recovery preservation, inactive listening, namespace collision isolation, and bounded history.
- Production frontend build, formatting, and diff checks passed.
- Mac app bundle built successfully; `codesign --verify --deep --strict` passed.
- Isolated browser harness with mocked desktop IPC: normal translation, 60-repeat long translation, and failed translation all kept the input rectangle at x=326, y=557.203125, width=830, height=76 at a 1280×720 viewport. Long captions scrolled in the subtitle region. No below-composer result panel remained.
- Local screenshot: `native/macos/.build/composer-layout.png` (ignored test artifact).
- Existing running app was not restarted, preserving the user's current session credentials and input. No real API calls or credential access were needed for these UI checks.
