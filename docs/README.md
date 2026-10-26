# 文档中心

[项目首页](../README.md) · [下载安装](https://github.com/Zhiruosama/VoxBridge/releases) · [反馈问题](https://github.com/Zhiruosama/VoxBridge/issues)

第一次使用，从[开始使用](guides/getting-started.md)读起。已安装的用户可以直接按下面的任务查找，不必从头读完所有文档。

## 安装和使用

| 你想了解 | 文档 | 主要内容 |
| --- | --- | --- |
| 如何开始 | [开始使用](guides/getting-started.md) | 下载、安装、选择功能、首次配置 |
| 密钥和模型怎么填 | [服务配置](guides/services.md) | 三类服务、保存密钥、测试连接、模型与音色预设 |
| 只需要文字翻译 | [文本翻译](guides/text-translation.md) | 输入、语言、复制、重试、分栏 |
| 想看翻译字幕 | [监听与悬浮字幕](guides/listening.md) | 选择应用、权限、字幕语言、浮窗 |
| 想让对方听到生成的语音 | [语音输入与虚拟麦克风](guides/voice-output.md) | 录音、发送、试听、Discord 路由与队列 |
| 想调整界面 | [外观与操作偏好](guides/appearance.md) | 主题、语言、颜色、字号、宽度、不透明度 |
| 功能没有正常工作 | [常见问题与排错](guides/troubleshooting.md) | 无声、权限、设备、翻译失败和兼容性 |

平台和辅助说明：[Windows 安装、更新与卸载](windows-installation.md) · [诊断日志](diagnostics.md) · [使用指南总览](user-guide.md)

## 开发和贡献

普通使用者无需阅读这一部分。

- [开发与打包](development.md)：环境搭建、启动、测试、构建与发布。
- [架构总览](02-architecture.md)：模块边界、音频路由、配置和凭据。
- [内部流程](internal-flows.md)：字幕修订、发送队列、文本翻译、取消与恢复。
- [Windows 开发入口](windows-development-todo.md)：实现状态和待验证项目。

## 发布与历史资料

- [发布记录](releases/README.md)：每次发行的功能、下载与已知限制。
- [验证记录](validation/README.md)：按专题查找实机测试和自动验证的范围。
- [设计与调研资料](archive/README.md)：早期方案、阶段记录和兼容性调查。

历史记录只说明当时验证过什么；其中的旧方案、命令和未决项不等于当前使用方式。日常操作以本目录上方的使用指南为准，特定安装包的差异以对应发布说明为准。
