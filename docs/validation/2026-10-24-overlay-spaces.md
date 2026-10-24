# Floating captions across macOS Spaces

**Superseded for cross-application full screen:** user testing showed these flags on the ordinary TaoWindow were insufficient. See [the native-panel follow-up](2026-10-24-overlay-panel.md). Window-targeted capture was not valid evidence of full-screen compositing.

## Change

The subtitle window was always-on-top but remained assigned to a single Space. Enabled Tauri's `visibleOnAllWorkspaces` for the subtitle window only.

Before each show/reopen, configure AppKit collection behavior on the main thread:

- `CanJoinAllSpaces`: remain available across desktops.
- `FullScreenAuxiliary` and `CanJoinAllApplications`: join eligible full-screen applications and opt out of Stage Manager grouping.
- Remove conflicting move-to-active-space, full-screen-primary/none, and Stage Manager primary/auxiliary flags, preserving unrelated window behavior.
- Keep the overlay visible when another application activates.

The main window retains its normal desktop assignment. Returning to the main window still explicitly hides captions; no timer or activation observer forces a hidden window to reappear.

## Validation

- Five overlay tests passed, including mutually exclusive AppKit flag handling, preservation of unrelated flags, idempotent reopening, existing snapshot validation and subtitle capability restrictions.
- Rust check, Clippy with warnings denied, and formatting passed. Production frontend and macOS app build passed, including the signed microphone-entitlement check.
- Restarted the production app and opened the native subtitle window. Issued desktop-switch shortcuts in both directions and obtained the caption window's accessibility state and window capture afterwards.
- Opened a temporary blank Chrome window, entered full screen, and obtained the subtitle window's state/capture while Chrome was full screen. Closed only that temporary test window afterwards. Window-targeted capture does not independently prove full desktop compositing; the exact three-finger gesture, multiple displays and user-specific full-screen/Stage Manager layouts remain user acceptance checks.
- Returning to the main window hides captions, and reopening works. Left the subtitle window open for user testing. No recording, call or cloud provider request was started.

References: [Apple fullScreenAuxiliary](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/fullscreenauxiliary), [Apple canJoinAllApplications](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallapplications).
