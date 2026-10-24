# Tencent microphone enumeration investigation (in progress)

## Confirmed observations

- Installed targets inspected: QQ 7.0.2 and personal WeChat 4.1.15. No app binaries or app configurations were modified.
- Core Audio lists VoxBridge as visible, alive, two input channels and two output channels. Input eligibility as a default device is true. Both legacy AVFoundation enumeration and a microphone/external discovery session list VoxBridge.
- A read of the input-scoped `kAudioDevicePropertyTransportType` succeeds and returns `0x76697274` (`virt`). System default input was unchanged throughout the experiments.
- QQ's installed `avsdk/libAVSDKPlugin.dylib`, arm64 slice SHA-256 `f37920a2f617c04471ffe74a751e4e369428cf9f5ec5ff24d389edc6910248ab`, contains two device-enumeration routines with Virtual-device filtering. At `0xfcf8f8` (diagnostic name `TraeAudioObjectDevicesNumber`) the input path queries `tran` / `inpt`, compares the result to `virt`, logs bypass and skips the device. The routine starting at `0xfcffd0` contains a corresponding check in the ID enumeration path.
- Ghidra reference evidence: `ev_a153eb6157f9900e5ac2d788132869df40c3dd12c120a5120e54f7dd2415ce64`; function evidence: `ev_8c9c9a4692de867ab194678516d34a71c9d641bb7565b7004e3fe209840e555b`. Default auto-analysis initially timed out; the successful CLI profile disabled Decompiler Parameter ID, Decompiler Switch Analysis, Stack and Objective-C Message Analyzer. Critical property constants, import-stub identities and branches were also checked against LLVM disassembly and native runtime property reads. Decompiler output is not original source.
- These are **static enumeration-path facts**, not a runtime trace proving which path the current QQ UI invokes. They establish a plausible exclusion path for the original driver, not the entire explanation for every missing device.

## Aggregate experiment: negative user result

- Created one public temporary aggregate named `VoxBridge 兼容性测试`, UID `com.voxbridge.audio.compatibility-test`, containing only the existing VoxBridge device. No physical microphone was opened, no audio IO started and no sound was sent. No CoreAudio restart, driver reinstall or default-device change occurred.
- System queries showed the aggregate as visible and alive, with two input/output channels and transport `0x61676772` (`aggr`). Both it and the original VoxBridge appeared in AVFoundation. Input default eligibility was true; output default eligibility inherited false from the original driver.
- User reported that neither QQ nor WeChat listed the temporary device after reopening their device lists. Therefore the aggregate approach is **not a verified compatibility solution**. A cold application restart with the aggregate already present has not yet been tested; a cached list or another enumeration/filter path remains possible.
- Removed the aggregate successfully (`AudioHardwareDestroyAggregateDevice` returned 0). Default input matched its original value after removal.

## WeChat: unresolved

- Inspected the arm64 slice of `Contents/Resources/wechat.dylib`, SHA-256 `6d3feb56043cb63d2ff3f77aa32115abbfe7a2f28b3ab1ab59886ee625703e4b`. REA Mach-O summary `ev_97f990d4ecbfb3eef35040fa211f34e226b52cea312478f43729638e91e111c2`, parent `ev_0207e858c00f803474d2f3d3774826ec22621d31b3e2c2a5bc445f0012edbeac`.
- A targeted ARM64 immediate-pattern search found a `virt` comparison in the routine at `0x56a84c0`. Its surrounding code performs data-source/name and transport-description handling. **This alone does not demonstrate that WeChat filters virtual microphones.** Other constant-load forms and unexamined call paths remain outside this bounded search.
- Tool-driven UI observation did not successfully read the independently opened device panel. The user clarified that the opened settings panel was QQ's. Neither WeChat's current live enumeration path nor a device-list refresh has been traced.
- QQ ASAR analysis was partial and did not recover an authoritative active call/device-enumeration handler. Evidence parent: `ev_2af51e75873612655d74ff9305cd9e47dc08f1854af4a248f4ac412b77b4e6ff`. Packaged asset discovery is not evidence of runtime execution.

## Next checks

1. Confirm QQ is not in a call or sharing a screen before a full application/audio-helper restart.
2. Recreate the temporary aggregate before QQ starts, then inspect the freshly initialized device list. Remove it again after the test.
3. Reproduce WeChat's own device panel separately; do not infer its behavior from QQ's SDK.
4. If cold enumeration still fails, trace the actual list-producing SDK path and inspect its requested properties/format checks before changing the driver. Do not disguise the driver as USB hardware or change system default input to obtain a superficial pass.

Local diagnostic code, raw disassembly, binary slices and device inventories are in ignored `native/macos/.build/tencent-audio/`; installed binaries and incidental application UI content are not included in this report or committed.
