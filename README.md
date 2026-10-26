# VoxBridge

**简体中文** · [English](README.en.md) · [日本語](README.ja.md)

[下载测试版](https://github.com/Zhiruosama/VoxBridge/releases) · [使用指南](docs/user-guide.md) · [问题反馈](https://github.com/Zhiruosama/VoxBridge/issues)

VoxBridge 是一款面向 **macOS 和 Windows** 的实时语音翻译工具：把应用声音变成双语字幕，也能把你输入的文字或录下的语音翻译、合成为语音，通过虚拟麦克风送入 Discord 等聊天软件。

0.4.0 新增独立文本翻译、请求重试与服务测试，并改进 Mac 窗口和语音设置。提供 Windows 11 x64、Windows ARM64 和 Apple Silicon Mac 安装包；本轮 Windows 实机回归待补充，ARM64 音频硬件仍待验收。

![VoxBridge：双语字幕与文字输入工作台](docs/assets/workspace-overview.png)

_界面演示，字幕为示例内容。_

## 可以做什么

- **文本翻译**：单独输入文字并选择目标语言，不调用录音或语音合成。
- **听与看**：选择要监听的应用，实时查看原文和翻译字幕。
- **说与打字**：输入文字或录音，修改确认后发送，也可开启语音直接发送。
- **悬浮字幕**：切换桌面或全屏窗口时继续阅读，也能在浮窗中输入。
- **选择自己的声音**：切换模型、音色和语速，独立控制本地试听。

## 下载与安装

| 平台 | 当前状态 | 安装方式 |
| --- | --- | --- |
| macOS 14.2+ · Apple Silicon | 0.4.0 测试版 | 下载 [DMG](https://github.com/Zhiruosama/VoxBridge/releases/tag/v0.4.0)，拖入「应用程序」 |
| Windows 11 · x64 | 0.4.0 测试版，本轮 Windows 实机回归待补充 | 下载 [x64 安装包](https://github.com/Zhiruosama/VoxBridge/releases/tag/v0.4.0)，直接运行 EXE |
| Windows · ARM64 | 实验版；原生 CI 与打包检查，真实音频硬件未验收 | 同一发布页下载 `arm64-setup.exe` |

安装包内置前端和原生程序，无需开发工具。Windows 安装器使用与应用一致的界面，支持可选虚拟麦克风、覆盖更新和配置保留；详见 [安装指南](docs/windows-installation.md)。系统缺少 WebView2 时会先使用兼容向导安装运行环境。Windows 10 尚未完成验收。

0.4.0 支持启动检查、签名更新、Windows 麦克风权限引导和 DPAPI 凭据保护。更新签名不等于系统厂商签名：Windows 安装器尚未进行 Authenticode 签名，Mac 测试版尚未通过 Developer ID 签名或公证；首次打开说明见[发布说明](https://github.com/Zhiruosama/VoxBridge/releases/tag/v0.4.0)。旧 Mac 0.2.1 没有应用内更新入口，需要手动下载新版。

## 开始使用

### 1. 配置服务

在设置中配置**语音识别、文字翻译、语音合成**服务，填写自己的 API Key 并保存。只看字幕时，配置识别与翻译即可。密钥保存后，重启无需重新填写。

已有 Qwen、DeepSeek 和 MiniMax 等配置预设，也支持相应兼容接口。云服务可能计费，音频和文字会发送给你选择的供应商。详见[服务配置](docs/user-guide.md#服务配置)。

### 2. 看翻译字幕

让目标应用播放声音，在工作台选择该应用，点击**开始监听**，按提示允许系统音频录制。点击**悬浮字幕**可在其他窗口上方阅读；字幕语言在设置中调整。

### 3. 在 Discord 中发声

1. 安装虚拟麦克风：Mac 在「设置 → 常规 → 音频」安装 VoxBridge 驱动；Windows 可在 VoxBridge 安装流程或设置页安装随包的 **VB-CABLE**，完成后按厂商提示重启电脑。驱动安装需要管理员授权，请先结束通话。
2. 将 VoxBridge 的**发送设备**设为下表对应端点，**试听设备**设为系统默认或耳机。
3. 在聊天软件的语音设置中选择对应的**输入设备**，输出设备保持耳机或扬声器。
4. 回到 VoxBridge，选择输出语言，输入文字或点击麦克风录音，再发送。耳机按钮控制自己是否试听。

| 平台 | VoxBridge 发送设备 | 聊天软件输入设备 |
| --- | --- | --- |
| macOS | VoxBridge | VoxBridge |
| Windows | CABLE Input (VB-Audio Virtual Cable) | CABLE Output (VB-Audio Virtual Cable) |

Windows 使用 VB-Audio 官方签名的基础版 VB-CABLE，保留厂商名称；来源为 [www.vb-cable.com](https://vb-audio.com/Cable/)，属于捐赠软件，欢迎支持作者。

Mac 主要验证 Discord；Windows 已验证本机虚拟麦克风音频回环，Discord、Oopz、KOOK 的实际通话收音仍待专项验收，不能据此保证所有聊天软件兼容。遇到无声或设备未出现，查看[使用指南](docs/user-guide.md#常见问题)。

## 更多

[详细使用指南](docs/user-guide.md) · [开发与打包](docs/development.md) · [Windows 当前进度与待办](docs/windows-development-todo.md) · [架构设计](docs/02-architecture.md) · [提交问题或建议](https://github.com/Zhiruosama/VoxBridge/issues)
