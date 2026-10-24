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
- User reported that neither QQ nor WeChat listed the temporary device after reopening their device lists. Therefore the aggregate approach is **not a verified compatibility solution**. This first experiment only reopened the lists; the later QQ cold-start experiment below produced a different result. A cached list or another enumeration/filter path remained possible at this stage.
- Removed the aggregate successfully (`AudioHardwareDestroyAggregateDevice` returned 0). Default input matched its original value after removal.

## QQ cold-start experiment: visibility confirmed by user

- Recreated the same public aggregate before restarting QQ. With the user confirming there was no active call or screen share and authorizing a restart, fully exited QQ and its audio helper, then launched QQ again. Both processes had new process IDs.
- The user reported that a microphone appeared, then explicitly identified its name as **`VoxBridge 兼容性测试`**. This verifies QQ's ability to list the aggregate after a full application restart in this test. It does not verify that QQ listed the original virtual device or establish every detail of its runtime filtering/caching path.
- Kept this second aggregate available for the user's audio test. It is still owned by the diagnostic helper; creation, persistence and cleanup have not been integrated into the product. No system default input change, physical microphone capture or test audio transmission was performed.
- Actual capture of VoxBridge speech through this device in QQ is **not yet verified**. Device-list visibility is a separate result from audio reception.

## WeChat: unresolved

- Inspected the arm64 slice of `Contents/Resources/wechat.dylib`, SHA-256 `6d3feb56043cb63d2ff3f77aa32115abbfe7a2f28b3ab1ab59886ee625703e4b`. REA Mach-O summary `ev_97f990d4ecbfb3eef35040fa211f34e226b52cea312478f43729638e91e111c2`, parent `ev_0207e858c00f803474d2f3d3774826ec22621d31b3e2c2a5bc445f0012edbeac`.
- A targeted ARM64 immediate-pattern search found a `virt` comparison in the routine at `0x56a84c0`. Its surrounding code performs data-source/name and transport-description handling. **This alone does not demonstrate that WeChat filters virtual microphones.** Other constant-load forms and unexamined call paths remain outside this bounded search.
- Tool-driven UI observation did not successfully read the independently opened device panel. The user clarified that the opened settings panel was QQ's. Neither WeChat's current live enumeration path nor a device-list refresh has been traced.
- QQ ASAR analysis was partial and did not recover an authoritative active call/device-enumeration handler. Evidence parent: `ev_2af51e75873612655d74ff9305cd9e47dc08f1854af4a248f4ac412b77b4e6ff`. Packaged asset discovery is not evidence of runtime execution.

## Next checks

1. Verify actual QQ audio reception with the user selecting the confirmed compatibility device in their own test context; do not initiate a call on their behalf.
2. Verify personal WeChat separately with the aggregate present before its audio module starts. The latest UI inspection reached its login screen, so no fresh WeChat device list was available. Do not infer its behavior from QQ's SDK.
3. If audio and application compatibility are confirmed, integrate an idempotent aggregate lifecycle into VoxBridge and exclude its input from physical-microphone recording to prevent feedback. The current helper is a diagnostic prototype only.
4. Clean up the temporary device after testing or replacing it with an integrated solution. Do not disguise the driver as USB hardware or change system default input to obtain a superficial pass.

Local diagnostic code, raw disassembly, binary slices and device inventories are in ignored `native/macos/.build/tencent-audio/`; installed binaries and incidental application UI content are not included in this report or committed.
