# Cross-application fullscreen: real native subtitle panel

[验证索引](README.md) · [当前使用指南](../user-guide.md)

> 历史验证记录：仅说明记录日期的测试范围，不代表所有平台、客户端或后续构建均通过。

## Why the earlier fix was insufficient

The user confirmed that ordinary NSWindow/TaoWindow collection flags did not keep captions above another application's fullscreen Space. Capturing the window independently showed its contents, not whether the desktop compositor displayed it. The earlier validation record is marked superseded.

## Implementation

- Allocate a genuine `NSPanel` subclass with the nonactivating style at initialization. No Objective-C class/superclass swapping and no changes to the main window's activation policy.
- Move the complete root view (including the existing WKWebView) into that panel. Tauri retains the webview's original label, IPC identity, capability restrictions and subtitle synchronization. The original native window remains hidden.
- Keep the panel in a main-thread-local retained owner; all show/hide/drag operations run on AppKit's main thread. Returning to the main window explicitly hides the real panel.
- Set floating behavior, then status-window level (25). AppKit resets the level to 3 when floating behavior is enabled, so the level must be applied afterwards.
- Retain all-Spaces/fullscreen-auxiliary/can-join-all-applications behavior. Showing from the workspace gives the panel keyboard focus for selection; switching to another app does not reactivate VoxBridge or steal focus.
- Route header dragging to the actual panel using coalesced pointer deltas. Match drag IDs to prevent stale movement from affecting a new drag. This avoids an asynchronous IPC entering a modal AppKit mouse loop. Buttons remain outside the draggable target; native edge resizing remains available.
- A local `overlay-window.json` under the application's Logs directory records only window geometry, visibility, active-Space membership, occlusion state and level. It updates on Space/occlusion changes and explicit panel operations. No caption text, audio, other app content or credentials are logged.

## Validation

- 129 native tests and 110 frontend tests passed. Overlay capability checks now grant only the dedicated drag command, not generic window dragging/maximizing. Rust Clippy (all targets, warnings denied), formatting, production build, code signature and microphone entitlement validation passed.
- Native UI identifies the caption window as a panel/system dialog instead of an ordinary window.
- With a separate blank Chrome window in fullscreen, the native panel reported `visible=true`, `onActiveSpace=true`, `unoccluded=true`, `level=25`. This checks actual AppKit presentation instead of relying only on a window capture. No user tab was modified; the temporary window was closed afterwards.
- Final pointer-drag implementation moved the real panel from `(484,587)` to `(559,557)` for a 150×60 screenshot-pixel drag on the 2× display. Edge resizing changed the captured panel from 1520×640 to 1640×720; the webview correctly expanded and the controls relaid out.
- Returning to the workspace hides the panel; showing it again works. During final checks the user returned to the workspace, so that selected UI state was preserved. The updated app remains running.
- No microphone, cloud request, voice call, system-default-device change or permission reset was used. Exact three-finger transitions and user-specific multi-display layouts still benefit from user acceptance testing.

References: [Apple NSPanel](https://developer.apple.com/documentation/appkit/nspanel), [Apple fullscreen auxiliary behavior](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/fullscreenauxiliary).
