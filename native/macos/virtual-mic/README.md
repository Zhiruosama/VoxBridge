# VoxBridge 虚拟麦克风（macOS）

此 AudioServerPlugIn 在系统中提供同名 `VoxBridge` 输入、输出设备。应用将合成音频播放到输出，Discord / Chrome 从输入接收。驱动不采集实体麦克风、不联网、不保存音频。不将该设备设为系统默认扬声器，避免意外把其他声音发送给通话。

## 构建、安装与使用

要求 macOS 14.2+、Xcode command line tools。执行 `bash native/macos/virtual-mic/build.sh`，先运行环形缓冲和 HAL 接口测试，再生成 `native/macos/.build/VoxBridgeAudio.pkg`。桌面打包会自动构建并嵌入该安装包。干净检出后直接运行 macOS `cargo test` 前也需要先执行此脚本，因为 Tauri 构建脚本会验证资源路径；CI 已在 Rust 检查之前执行它。

1. 在 VoxBridge 的设置 → 常规 → 音频点击“安装虚拟麦克风”，由系统安装器申请管理员授权。仅这次安装需要管理员权限，不涉及服务密钥或配置模板。
2. 安装位置为 `/Library/Audio/Plug-Ins/HAL/VoxBridge.driver`。安装器重启 CoreAudio，会短暂中断本机音频。请先结束通话。驱动为本机构建的 ad-hoc 签名，尚未公证。
3. 回到设置刷新设备，点击“用作发送设备”，将试听设备选为耳机并保存。
4. 刷新 Discord 网页，输入设备选择 `VoxBridge`，输出设备仍选耳机。若列表未刷新，完全退出并重新打开 Chrome；网站需要已有麦克风权限。
5. 主输入框耳机图标控制“发送时试听”。关闭只关闭本地副本，不影响 Discord 输入。试听可在播放中切换，不重新合成；中途开启只播放后续内容。试听设备失败会提示，主发送继续。

卸载：`sudo bash native/macos/virtual-mic/uninstall.sh`。脚本验证 bundle identity 后将驱动移到 `/Library/Application Support/VoxBridge/DriverBackups/` 并重启 CoreAudio。升级前也会备份已有同身份驱动。需要恢复时，由管理员将明确选定的备份恢复到 HAL 原位置再重启 CoreAudio。

## 来源和本地修改

基于 Apple 官方 [Creating an Audio Server Driver Plug-in](https://developer.apple.com/documentation/coreaudio/creating-an-audio-server-driver-plug-in) 的 NullAudio 示例，保留 MIT 许可（LICENSE-Apple.txt）。原始下载：
https://docs-assets.developer.apple.com/published/430ad6501f6f/CreatingAnAudioServerDriverPlugIn.zip

下载 SHA-256：`860334dfa9e83f2afb749a890ca5a79fc7d3d572d4e116ff9242bec458be4cb0`。

改动：独立 bundle / device UID、默认 48kHz、双声道 Float32 时间戳回环、512 帧延迟、32768 帧有限缓冲、静音/音量处理、无写入时静音、重启清理、不作为默认系统输出。实时回调不分配内存、不等待锁、不读写文件或网络；状态锁争用时返回静音。帧标签和 lock-free 原子样本防止陈旧数据重放。音量仅衰减，异常样本清零。

## 验证边界

`test-loopback.c` 检查环绕、过期数据、重复读取、静音/增益、重置和异常值。`test-driver.c` 检查实际驱动的属性、UID、启动/停止、读写 IO、静音和缓冲边界，不向 coreaudiod 加载测试代码。

本批构建与这些测试已通过；尚未安装进系统，因此真实 HAL 调度、Chrome 枚举、Discord 输入与长时间双路播放仍需安装后验收。不能将源码回环测试视为 Discord 实际收音通过。当前构建仅针对本机架构；公开分发前还需要目标架构、签名/公证与安装兼容性验证。

## 已安装设备诊断

`xcrun swiftc -warnings-as-errors native/macos/virtual-mic/probe.swift -o native/macos/.build/virtual-mic-probe`。

- 默认只列出 Core Audio 设备，不启动录音或输出。
- `--tone`：明确向 VoxBridge 输出端写入 3 秒、幅度 0.1 的 440Hz 测试音，并读取同一虚拟设备输入；不打开实体麦克风。选择该输入的聊天软件也可能收到测试音，请仅在本地调试或获准的测试通话中使用。
- `--listen`：15 秒内输出静音，仅统计 VoxBridge 输入的峰值、RMS 和非零样本；可在此期间从应用发送测试语音。不保存音频。

2026-10-23 实机：0.1.0 已安装驱动在 Core Audio 与 AVFoundation 均显示 VoxBridge。48kHz 回环测试峰值 0.1、RMS 约 0.07049；修正应用的发送设备后，真实合成语音输入峰值约 0.29514，RMS 约 0.01693。此结果确认应用 → 虚拟设备输入链路，尚不等于 Discord 扬声器回放已验证。

0.1.1 将设备、输入/输出流、数据源名称统一为 VoxBridge。Chromium 显示所选数据源名，0.1.0 因而显示 `Data Source Item 0 (Virtual)`；更新安装包并重新加载设备后才会显示新名称。UID 不变，已有设备选择可保留。QQ 7.0.2 在重启后仍未列出虚拟输入或输出，原因未确认，按用户要求暂缓；未改动系统默认输入或伪装硬件类型。
