# VoxBridge

**简体中文** · [English](README.en.md) · [日本語](README.ja.md)

[下载安装](https://github.com/Zhiruosama/VoxBridge/releases) · [开始使用](docs/guides/getting-started.md) · [文档中心](docs/README.md) · [反馈问题](https://github.com/Zhiruosama/VoxBridge/issues)

VoxBridge 是一款 macOS 和 Windows 翻译工具。它可以把应用声音显示为双语字幕，也可以翻译你输入的文字或录下的语音，通过虚拟麦克风在 Discord 等聊天软件中发声。

![VoxBridge 工作台](docs/assets/workspace-overview.png)

_界面示意，字幕为示例内容。_

## 可以做什么

- **文本翻译**：输入文字、选择目标语言并复制译文，无需录音或生成语音。
- **翻译字幕**：选择要监听的应用，查看原文和译文。
- **语音表达**：打字或录音，确认内容后生成语音；可以选择本地试听或发送到虚拟麦克风。
- **悬浮窗口**：在其他窗口上方阅读字幕，也能直接打字或录音。
- **声音与外观**：选择服务、模型、音色和语速，调整字幕颜色、字号与面板外观。

## 下载与安装

到 [Releases](https://github.com/Zhiruosama/VoxBridge/releases) 选择适合自己电脑的安装包。安装包已包含前端和原生程序，无需安装开发工具。

| 电脑 | 选择的文件 | 安装方式 |
| --- | --- | --- |
| Apple Silicon Mac，macOS 14.2 或更高 | `aarch64.dmg` | 打开后拖入「应用程序」 |
| Windows 11，Intel / AMD | `x64-setup.exe` | 运行安装器 |
| Windows ARM64 | `arm64-setup.exe` | 实验支持，音频硬件兼容性仍待验证 |

Mac 应用尚未完成 Developer ID 签名和公证，Windows 应用尚未做 Authenticode 签名。首次打开、虚拟麦克风安装及升级方式见[安装指南](docs/guides/getting-started.md)。各平台的验证范围以[发布说明](https://github.com/Zhiruosama/VoxBridge/releases)为准。

## 开始使用

1. 打开设置，填写需要使用的模型服务和自己的 API Key。**只翻译文字，只需配置文字翻译服务。**
2. 左侧选择「文本翻译」开始打字，或选择「字幕」并指定要监听的应用。
3. 如需向聊天软件发送语音，再配置语音合成与虚拟麦克风；自己是否试听可单独控制。

密钥保存后无需每次重启重新填写。云服务按供应商规则计费，相关文字或音频会发送给你选择的服务；安装包不包含密钥、额度或私人克隆音色。

## 按需要阅读

| 想做什么 | 阅读这里 |
| --- | --- |
| 第一次安装和配置 | [开始使用](docs/guides/getting-started.md) |
| 配置模型、密钥和音色 | [服务配置](docs/guides/services.md) |
| 只翻译一段文字 | [文本翻译](docs/guides/text-translation.md) |
| 看应用声音的翻译字幕 | [监听与悬浮字幕](docs/guides/listening.md) |
| 在 Discord 等软件中发送语音 | [语音输入与虚拟麦克风](docs/guides/voice-output.md) |
| 遇到无声、报错或权限问题 | [常见问题与排错](docs/guides/troubleshooting.md) |

开发、架构和历史记录统一从[文档中心](docs/README.md)进入。
