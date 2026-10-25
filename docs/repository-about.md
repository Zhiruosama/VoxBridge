# GitHub About

仓库描述建议值（适用于 Windows 实现尚在测试、未公开发布的阶段）：

> macOS / Windows 实时语音翻译工具，支持双语字幕、文字与语音输入、语音合成和虚拟麦克风。Windows 11 x64 测试中。Real-time speech translation for macOS and Windows with bilingual captions and virtual microphone output.

仅修改 Description，保留现有网站地址和 Topics。README 的代码改动需要合并到默认分支，仓库首页才会显示；About 是独立的仓库元数据，不会随分支提交自动更新。

可在仓库首页 About 的编辑入口修改，或在已经通过 `gh auth login` 登录的环境执行：

```sh
gh repo edit Zhiruosama/VoxBridge --description 'macOS / Windows 实时语音翻译工具，支持双语字幕、文字与语音输入、语音合成和虚拟麦克风。Windows 11 x64 测试中。Real-time speech translation for macOS and Windows with bilingual captions and virtual microphone output.'
```
