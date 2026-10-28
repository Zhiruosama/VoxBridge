# Mac 主窗口缩放与内容尺寸

[验证记录](README.md) · [排错指南](../guides/troubleshooting.md)

## 问题

用户双击主窗口顶栏后，窗口尺寸瞬间变化，内容可能被裁切，或右侧保留大片空白。此前 Mac 网页顶栏使用框架注入的默认双击最大化处理。

## 调整

- AppKit 本地鼠标事件监视器接收主窗口顶部 32 个逻辑点内的双击，排除红黄绿按钮区，并消费该次事件，避免系统默认瞬间缩放。网页顶栏保留单击拖动及专用命令作为后备。其他窗口、正文区、右键和连续第三次点击不触发这条路径。
- 双击在当前桌面铺满所在屏幕的可用区域，再次双击还原。使用 `NSAnimationContext` 和 `NSWindow.animator()`，由 AppKit 自己决定默认时长、插值和帧调度；不再手写计时器或缓动曲线。保存逻辑坐标，还原位置限制在当前屏幕内；完成回调带序号，避免旧动画的回调清除新状态。
- 原生 resize 和 backing-scale 变化通知校正 WKWebView 到其父视图的 bounds，同时显式启用父子视图的宽高自动伸缩。不以物理像素直接设置网页尺寸。
- 不更换 Tao 窗口类或代理，不改变现有标题栏主题、红黄绿按钮、音频或设置。专用命令只授权 Mac 主窗口，Windows 沿用原实现。

## 补充排查

这里验证的是“桌面铺满／还原”，不是绿色按钮进入另一个 Space 的 macOS 全屏。之前的同步 `setFrame:display:animate:` 调用虽然能产生多个原生 resize 通知，但这不足以证明页面在每个中间尺寸得到绘制。随后分帧实现虽然有连续页面绘制，但用户希望使用原生观感，因此最终切换为异步 AppKit 动画代理。测试继续记录页面的 `requestAnimationFrame` 尺寸变化，并在中途与结束时断言原生 FullScreen 标志始终未设置。绿色按钮的 Space 全屏行为保持原样。

最初只测试了网页顶栏下沿（距顶部 32 个逻辑点的位置），没有覆盖被 AppKit 原生透明标题栏截获的上半部分，因此用户双击最上方时仍走系统默认缩放。修复增加原生鼠标事件入口，不再依赖 React 能收到该区域的双击。

同一提交的 Windows CI 编译失败来自非 Mac 分支调用不存在的 `WebviewWindow::toggle_maximize`。改用公开的 `is_maximized`、`maximize`、`unmaximize` 方法；Windows 现有顶栏仍沿用自己的处理逻辑。

## 验证

独立测试应用加载实际 Mac 顶栏组件及应用样式，不读取配置或调用模型。

- 原生代理实际双击测试（距顶部 12 个逻辑点）：页面从 `1050×700` 铺满到 `1728×1025`，页面绘制回调观察到 14 个尺寸变化；还原到原尺寸时又观察到 14 个尺寸变化。
- 异步回归在开始 160ms 时验证窗口处于初始尺寸与目标尺寸之间；完成铺满和还原后再检查精确边界，一轮共记录 57 次 resize 通知，`fullscreen=false`。
- 原生回归在每块现有显示器上改变窗口大小，并故意设置错误的网页视图 frame；最终网页 frame 与父视图 bounds 一致。
- 还原位置测试覆盖负坐标显示器、超出当前屏幕的旧位置和大于当前屏幕的旧尺寸。
- 283 项前端测试、172 项 Rust 测试通过；23 项显式忽略的集成测试未运行。Mac 打包与签名检查通过。

手动复测：先运行 `npm run dev`，再运行 `cargo run --manifest-path src-tauri/Cargo.toml --example main-zoom-regression`。双击顶栏或点击“运行原生回归”。工具会短暂移动自己的测试窗到各显示器，不移动用户的其他窗口；最长运行十分钟，不应在用户工作时自动启动。

## 参考

- [Apple：NSAnimationContext](https://developer.apple.com/documentation/appkit/nsanimationcontext)
- [Apple：animator() 动画代理](https://developer.apple.com/documentation/appkit/nsanimatablepropertycontainer/animator())
