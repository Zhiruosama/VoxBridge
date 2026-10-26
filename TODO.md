# 维护与验证待办

[文档中心](docs/README.md) · [开发与打包](docs/development.md) · [历史开发记录](docs/archive/development-log.md)

这里仅列当前仍需完成的维护和实机验证，不作为使用教程。已发布功能和下载见 [Releases](https://github.com/Zhiruosama/VoxBridge/releases)，操作说明见[使用指南](docs/user-guide.md)。

## 实机验证

- [ ] Windows 新界面、文本翻译、请求恢复与服务测试的实际使用回归。
- [ ] Windows ARM64 的真实音频硬件、虚拟麦克风与聊天软件收音。
- [ ] Windows 干净机器安装、覆盖更新、热插拔、睡眠唤醒和长时间运行矩阵。
- [ ] Mac 多屏拖动、显示器拔插、全屏切换和休眠唤醒的长期验证。
- [ ] QQ、微信虚拟麦克风兼容性，跟踪 [issue #1](https://github.com/Zhiruosama/VoxBridge/issues/1)。
- [ ] 多人场景的说话人区分与不同 ASR 模型的能力评估。

## 发行与维护

- [ ] Apple Developer ID 签名与公证。
- [ ] Windows Authenticode 签名。
- [ ] Windows 10 和其他未声明环境的独立验收；通过前不扩大支持承诺。
- [ ] 补充干净机器和真实聊天软件的使用证据，持续更新[验证索引](docs/validation/README.md)。

具体 Windows 工作见[平台待办](docs/windows-development-todo.md)。实时字幕研究后续项见[实施记录](docs/12-streamvox-optimization-progress.md)。历史检查项保留在[开发过程记录](docs/archive/development-log.md)，不再与当前待办混排。
