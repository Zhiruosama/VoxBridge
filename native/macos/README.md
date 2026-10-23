# Mac 音频采集探针

这是与产品分开的 Core Audio taps 可行性工具。2026-10-23 已在 macOS 26.4 / Apple Silicon、Swift 6.3.3 上使用 Swift 5 模式及 macOS 14.2 目标完整构建，并通过 ad-hoc 签名校验；编译警告视为错误。**尚未运行采集或验证权限 / 电平**，不要将构建通过视为桌面应用集成或最低系统实机兼容性已完成。

要求：macOS 14.2+、Apple Command Line Tools，开发 SDK 需包含 Core Audio taps API。参考 [Apple 官方示例](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)。

在仓库根目录执行：

```sh
bash native/macos/build-probe.sh
native/macos/.build/VoxBridgeAudioProbe.app/Contents/MacOS/AudioProbe list
native/macos/.build/VoxBridgeAudioProbe.app/Contents/MacOS/AudioProbe capture <PID> 10
```

先让目标应用播放声音，再从 `list` 结果选择实际音频进程 PID。采集最长 60 秒，只打印 RMS 与样本数，不保存或上传音频。测试期间不要用强制结束替代正常超时退出；正常退出会释放 IOProc、聚合设备和 tap。

首次可能出现系统音频权限提示。允许后如无电平，检查应用是否播放、是否由子进程发声、系统隐私设置是否授权对应应用或终端。ad-hoc 签名只是本地开发用途，不能证明分发签名与权限流程可用。

成功条件：目标发声时 RMS 大于零、静音时接近零、其他应用发声不混入；至少重复 20 次正常启停，无残留对象。记录 Mac 型号、系统、SDK、目标进程、权限过程与输出。

探针暂只解析 Float32 PCM；其他格式明确失败。回调只计算电平并使用非阻塞锁尝试更新统计；它不是正式 PCM 流 / 重采样实现。跨平台 Rust 音频接入、音频进程归属与断连恢复仍需后续开发。
