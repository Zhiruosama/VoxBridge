# 设计与历史资料

[文档中心](../README.md) · [当前开发指南](../development.md) · [当前架构](../02-architecture.md)

这里面向维护者，保留设计背景和阶段性证据。文档中的“计划”“尚未实现”和旧方案只适用于写作当时，不应直接当成安装、凭据存储或功能状态的说明。普通使用者请看[开始使用](../guides/getting-started.md)。

## 设计背景

| 资料 | 用途 |
| --- | --- |
| [需求与验收](../01-requirements.md) | 早期场景、范围和验收目标 |
| [macOS 音频设计](../03-macos-audio.md) | 音频 API、采集和设备取舍 |
| [AI 流水线设计](../04-ai-pipeline.md) | 识别、翻译、合成及延迟方案 |
| [产品交互设计](../05-product-interaction.md) | 早期界面和状态方案 |
| [开发验证计划](../06-development-validation.md) | 阶段计划与验证方法 |
| [决策记录](../07-decisions.md) | 设计决策及其背景 |
| [服务协议专题](../08-provider-configuration.md) | 协议兼容与扩展思路，当前适配器以代码为准 |
| [语音后端专题](../10-speech-backend.md) | TTS 早期接入与阶段记录 |

## 平台与调研记录

- [Windows 原始交接](../windows-handoff.md)：移植前的背景和实施计划，当前进度看[开发待办](../windows-development-todo.md)。
- [实时字幕优化记录](../12-streamvox-optimization-progress.md)：从调研到实施的阶段范围。
- [虚拟麦克风与试听专题](../13-virtual-microphone-and-monitoring.md)：历史路由和实测边界。
- [微信虚拟麦克风调查](../wechat-virtual-microphone-investigation.md)：兼容性证据，不等于普通安装可用承诺。

本地未提交的 StreamVox 原始调研和证据文件不作为公开用户指南的依赖。

## 旧开发记录

- [开发过程记录](development-log.md)：原 TODO 的历史检查项与测试过程。
- [旧开发指南](legacy-development.md)：早期工作台和联调状态，保留供追溯。
- [按专题查找验证记录](../validation/README.md)。

原技术文档路径继续保留，便于已有链接访问；新的开发工作从[开发与打包](../development.md)和[内部流程](../internal-flows.md)开始。
