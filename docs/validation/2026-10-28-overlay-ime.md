# macOS 悬浮窗输入法候选框

[验证记录](README.md) · [排错指南](../guides/troubleshooting.md)

## 问题与处理

用户反馈：切到其他应用后在实时字幕悬浮窗打字，中文输入仍可提交，但拼音候选词框不可见。

字幕窗使用不激活应用的 NSPanel，平时保持 status 层级。此时收到键盘事件不等于输入法已绑定正确的前台应用；过高的窗口层级也可能遮住系统候选窗。这是依据原生窗口实现推断的两个风险点，并非已测定的单一根因。

显式展开或聚焦文字输入时，将同一个面板暂时降到普通 floating 层级，使其成为 key window，并在需要时激活应用。对现有原生输入上下文只刷新光标屏幕坐标，不手动启停上下文、不清除组合文字。收起编辑器后恢复字幕层级；普通字幕更新不会激活应用。

保留原来的 NSPanel 类型、跨 Spaces／全屏属性和隐藏宿主结构；不显示或前置主窗口。Windows 的原生处理为空操作。新增命令只授权给 subtitle WebView。

前端在输入法组合期间忽略自定义 Enter／Escape 快捷键，避免确认候选词时发送、取消候选词时收起编辑器。

## 验证范围

- 280 项前端测试、170 项 Rust 测试通过（23 项显式忽略的集成测试未运行）。
- 隐藏原生面板回归通过：重复准备、窗口独立性、拖动／缩放／隐藏仍正常；隐藏面板不能通过编辑命令激活；结束编辑不改变窗口样式或 Spaces 属性。
- 前端构建、格式检查通过。
- 交互式原生候选框验证中途停止，测试窗口已关闭；未确认真实候选框可见性、跨全屏输入和多显示器输入效果。后续由用户正常使用时验证，不能以自动测试替代。
- 本轮不调用 ASR／TTS，不读取用户配置或剪贴板。

手动复现工具：先运行 `npm run dev`，再显式运行 `cargo run --manifest-path src-tauri/Cargo.toml --example overlay-ime-regression`。它会创建临时测试窗，180 秒后退出；不要在用户工作时自动运行。用系统拼音输入真实键盘字符，检查候选框，测试后关闭工具。

参考：[Apple NSPanel 焦点策略](https://developer.apple.com/documentation/appkit/nspanel/becomeskeyonlyifneeded)、[Ghostty 非激活面板输入上下文讨论](https://github.com/ghostty-org/ghostty/discussions/14213)。后者仅为同类故障的诊断参考。
