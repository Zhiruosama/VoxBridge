# 验证记录索引

[文档中心](../README.md) · [开发与打包](../development.md) · [排错指南](../guides/troubleshooting.md)

这些是开发和实机验证记录，按主题而非提交顺序阅读。需要解决使用问题时先看排错指南；自动测试、模拟服务和真实通话的结论不能互相替代。每篇记录保留原日期、环境及未验证边界。

- [逐句与自然段显示](2026-10-27-caption-layout.md)：共享投影、稳定段落身份和回归范围。

## 监听、识别与字幕

- [Windows 与 Mac 后端对齐](2026-10-26-windows-backend-parity.md) — 2026-10-26

- [Application selection for listening](2026-10-23-application-capture.md) — 2026-10-23
- [2026-10-23 Mac 受控音频闭环](2026-10-23-capture-loop.md) — 2026-10-23
- [More frequent realtime subtitle translation](2026-10-23-faster-realtime-translation.md) — 2026-10-23
- [Natural captions, independent direction and validated translations](2026-10-23-natural-caption-quality.md) — 2026-10-23
- [2026-10-23 千问实时识别](2026-10-23-realtime-asr.md) — 2026-10-23
- [Stable short caption chunks](2026-10-23-stable-short-captions.md) — 2026-10-23
- [User-managed model and voice presets](2026-10-24-profile-preset-library.md) — 2026-10-24
- [Speech presets and switching voices while listening](2026-10-24-speech-picker.md) — 2026-10-24
- [单句译文校验失败导致监听停止](2026-10-25-listening-translation-failures.md) — 2026-10-25

## 文字输入与翻译

- [Clear input after successful send](2026-10-23-clear-composer.md) — 2026-10-23
- [输出期间编辑下一段草稿](2026-10-23-composer-drafts.md) — 2026-10-23
- [Composer subtitles and stable input layout](2026-10-23-composer-subtitles.md) — 2026-10-23
- [目标语言与同语言直读](2026-10-23-target-languages.md) — 2026-10-23
- [可配置翻译前置 Prompt](2026-10-23-translation-prompt.md) — 2026-10-23
- [高优先级体验优化验证](2026-10-26-priority-ux.md) — 2026-10-26
- [独立文本翻译页面验证](2026-10-26-text-translation.md) — 2026-10-26

## 语音输入、合成与音频输出

- [2026-10-23 同时收发与自动恢复](2026-10-23-duplex-recovery.md) — 2026-10-23
- [2026-10-23 MiniMax 流式输出](2026-10-23-streaming-tts.md) — 2026-10-23
- [2026-10-23 TTS 后端验证](2026-10-23-tts.md) — 2026-10-23
- [Voice input from floating captions](2026-10-24-floating-voice.md) — 2026-10-24
- [Microphone voice input](2026-10-24-microphone-input.md) — 2026-10-24
- [Voice input controls and one-minute recordings](2026-10-24-voice-input-controls.md) — 2026-10-24

## 界面与悬浮窗口

- [侧栏拖动与主窗宽度限制](2026-10-26-sidebar-layout-limits.md) — 2026-10-26

- [Mac 主题切换中断与备用动画](2026-10-26-theme-transition.md) — 2026-10-26

- [Chrome discovery and stable picker scrolling](2026-10-23-chrome-picker-scroll.md) — 2026-10-23
- [Content-only text selection](2026-10-23-text-selection.md) — 2026-10-23
- [主动输入动画与工作台字幕配色](2026-10-24-caption-appearance.md) — 2026-10-24
- [Floating caption colors](2026-10-24-overlay-colors.md) — 2026-10-24
- [Cross-application fullscreen: real native subtitle panel](2026-10-24-overlay-panel.md) — 2026-10-24
- [Floating captions across macOS Spaces](2026-10-24-overlay-spaces.md) — 2026-10-24
- [启动白屏与加载反馈](2026-10-25-startup-screen.md) — 2026-10-25
- [悬浮窗隐藏宿主在显示器变化时崩溃](2026-10-26-overlay-host-crash.md) — 2026-10-26
- [macOS 悬浮窗跨屏拖动修复](2026-10-26-overlay-multiple-displays.md) — 2026-10-26

## 密钥、权限与服务

- [麦克风选择与设置保护](2026-10-26-microphone-settings-recovery.md) — 2026-10-26

- [2026-10-23 设置页重复钥匙串提示修复](2026-10-23-keychain-status.md) — 2026-10-23
- [2026-10-23 真实服务验证](2026-10-23-live-providers.md) — 2026-10-23
- [日常密钥持久化](2026-10-23-persistent-credentials.md) — 2026-10-23
- [2026-10-23 显式模板授权与本次密钥](2026-10-23-session-templates.md) — 2026-10-23
- [Packaged microphone authorization fix](2026-10-24-microphone-entitlement.md) — 2026-10-24
- [私有本机凭据存储与真实重启验收](2026-10-24-private-credentials.md) — 2026-10-24

## Windows、驱动与安装

- [2026-10-22 Windows 开发验证](2026-10-22-windows.md) — 2026-10-22
- [Tencent microphone enumeration investigation (in progress)](2026-10-24-tencent-input-enumeration.md) — 2026-10-24
- [Windows 自定义安装界面](2026-10-25-windows-installer.md) — 2026-10-25
- [Windows 原生采集与独立程序验证](2026-10-25-windows-native.md) — 2026-10-25
