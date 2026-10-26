# Chrome discovery and stable picker scrolling

[验证索引](README.md) · [当前使用指南](../user-guide.md)

> 历史验证记录：仅说明记录日期的测试范围，不代表所有平台、客户端或后续构建均通过。

Chrome was running but missing from the earlier list. LaunchServices reported the main application at `/Applications/Google Chrome.app`, while `proc_pidpath` returned a macOS signing clone ending in `Google Chrome.app.bundle`. The old `.app`-only ancestor check rejected that executable. Discovery now uses LaunchServices bundle identity and localized name directly; audio-process ownership also recognizes the exact `.app.bundle` clone suffix, including nested helpers. This keeps the picker and capture identity consistent.

The dropdown's dynamically mounted Radix scroll buttons changed viewport height at scroll boundaries. They were removed in favor of a fixed, bounded native scrolling viewport. Refreshing application options no longer disables the trigger while the menu is open.

Validation:

- 76 frontend tests passed; 73 Rust tests passed with 15 opt-in tests ignored. Clone-root and nested-helper cases were added to the existing path regression test.
- An explicitly invoked read-only native inventory enumerated 20 apps, including both Google Chrome and WeChat. It also checked that the current Chrome main PID resolves to the same bundle identity as the picker and that matched audio objects belong to their selected application. No taps, credential access, or cloud service calls occurred.
- In a 42-option isolated desktop IPC harness, menu top stayed at 101.5 px, outer height at 320 px and viewport height at 308 px while scrollTop moved from 0 to 1220.5 and back to 500.5. No dynamic scroll buttons remained.
- Frontend production build, formatting, diff checks, Clippy with warnings denied, Mac app build and strict deep codesign verification passed.
- Screenshot: `native/macos/.build/stable-application-scroll.png` (ignored test artifact).
- Running app was not restarted, preserving current session credentials. Native WebKit trackpad feel and live Chrome/WeChat conversation capture remain interactive acceptance items.
