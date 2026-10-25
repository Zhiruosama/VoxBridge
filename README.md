# VoxBridge

**简体中文** · [English](README.en.md) · [日本語](README.ja.md)

[下载测试版](https://github.com/Zhiruosama/VoxBridge/releases) · [使用指南](docs/user-guide.md) · [问题反馈](https://github.com/Zhiruosama/VoxBridge/issues)

VoxBridge 是一款 Mac 实时语音翻译工具：把应用声音变成双语字幕，也能把你输入的文字或录下的语音翻译、合成为语音，通过虚拟麦克风送入 Discord 等聊天软件。

![VoxBridge：双语字幕与文字输入工作台](docs/assets/workspace-overview.png)

_界面演示，字幕为示例内容。_

## 可以做什么

- **听与看**：选择要监听的应用，实时查看原文和翻译字幕。
- **说与打字**：输入文字或录音，修改确认后发送，也可开启语音直接发送。
- **悬浮字幕**：切换桌面或全屏窗口时继续阅读，也能在浮窗中输入。
- **选择自己的声音**：切换模型、音色和语速，独立控制本地试听。

## 下载与安装

下载 [**0.1.0 测试版 DMG**](https://github.com/Zhiruosama/VoxBridge/releases/tag/v0.1.0)，打开后将 VoxBridge 拖入「应用程序」。

目前提供 **Apple Silicon（M 系列）Mac、macOS 14.2+** 安装包，无需安装开发工具。测试版尚未公证，首次打开可能被 macOS 拦截，处理步骤见[发布说明](https://github.com/Zhiruosama/VoxBridge/releases/tag/v0.1.0)。

## 开始使用

### 1. 配置服务

在设置中配置**语音识别、文字翻译、语音合成**服务，填写自己的 API Key 并保存。只看字幕时，配置识别与翻译即可。密钥保存后，重启无需重新填写。

已有 Qwen、DeepSeek 和 MiniMax 等配置预设，也支持相应兼容接口。云服务可能计费，音频和文字会发送给你选择的供应商。详见[服务配置](docs/user-guide.md#服务配置)。

### 2. 看翻译字幕

让目标应用播放声音，在工作台选择该应用，点击**开始监听**，按提示允许系统音频录制。点击**悬浮字幕**可在其他窗口上方阅读；字幕语言在设置中调整。

### 3. 在 Discord 中发声

1. 在「设置 → 常规 → 音频」安装内置的**虚拟麦克风**。安装需要管理员授权，请先结束通话。
2. 将 VoxBridge 的**发送设备**设为 VoxBridge，**试听设备**设为系统默认或耳机。
3. 在 Discord 的语音设置中，将**输入设备**选为 VoxBridge，输出设备保持耳机或扬声器。
4. 回到 VoxBridge，选择输出语言，输入文字或点击麦克风录音，再发送。耳机按钮控制自己是否试听。

Discord 是目前主要验证的场景，QQ、微信兼容性仍在完善。遇到无声或设备未出现，查看[使用指南](docs/user-guide.md#常见问题)。

## 更多

[详细使用指南](docs/user-guide.md) · [开发与打包](docs/development.md) · [架构设计](docs/02-architecture.md) · [提交问题或建议](https://github.com/Zhiruosama/VoxBridge/issues)
