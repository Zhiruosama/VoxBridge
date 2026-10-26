# Packaged microphone authorization fix

[验证索引](README.md) · [当前使用指南](../user-guide.md)

> 历史验证记录：仅说明记录日期的测试范围，不代表所有平台、客户端或后续构建均通过。

## Confirmed cause

macOS TCC logs for the production process (`com.voxbridge.desktop`) explicitly reported:

> service: kTCCServiceMicrophone requires entitlement com.apple.security.device.audio-input but it is missing

The signed `.app` had hardened runtime enabled and a valid `NSMicrophoneUsageDescription`, but no signed entitlements. macOS denied microphone access before displaying an authorization request. Querying AVFoundation's authorization status in unit tests did not catch this packaging failure.

The “VoxBridge Persistence Test” item belongs to the earlier isolated persistence-validation bundle. Its bundle/signing identifier differs from the production application; that item's permission does not authorize VoxBridge.

## Change and validation

- Added `src-tauri/Entitlements.plist` with only `com.apple.security.device.audio-input=true`, and configured Tauri's macOS bundler to sign with it.
- Added a post-build artifact check for the standard desktop build commands. It verifies the code signature, extracts the signed entitlements as XML, checks the audio-input grant declaration and checks the microphone usage description. Missing entitlements fail the build.
- Rebuilt the macOS `.app`; the signed production artifact contains the required entitlement and passes the new verification.
- Frontend tests and formatting passed. The underlying recording/ASR code is unchanged.
- No TCC database edits, permission resets or system input changes. Granting microphone permission and a real spoken recording remain user acceptance steps in the updated app.

Reference: [Apple Audio Input Entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input).
