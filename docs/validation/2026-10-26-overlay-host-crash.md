# 悬浮窗隐藏宿主在显示器变化时崩溃

## 用户报告与定位

用户提供的 2026-10-26 13:18 崩溃报告中，进程为已安装的 VoxBridge，主线程在 `tao::window_did_change_backing_properties` 内 panic，越过 Objective-C 回调边界后触发 SIGABRT。上游调用来自 AppKit 的显示器配置更新。

本机依赖 Tao 0.37.1 的 `WindowDelegateState::ns_view()` 强制 `unwrap()` 原窗口 `contentView()`。VoxBridge 原实现将整个根视图转交给 NSPanel 后，对原窗口调用 `setContentView(None)`。原窗口虽然被隐藏，仍归 Tao 持有，仍会收到缩放和尺寸回调。这是应用转交视图时破坏宿主不变量的问题，与 TTS 情绪参数无关。

## 修复

- 抽出 `overlay/panel/content.rs`，在原宿主中原子替换为同尺寸占位 NSView，再将已有根视图交给 NSPanel；不存在故意清空宿主的中间步骤。
- 不修改 Tao 的 Objective-C 类、对象布局或 delegate。原 WebView、IPC 身份与悬浮窗输入行为保留。
- panic hook 增加最多 800 ms 的元数据刷新尝试；写线程自身 panic 不等待自身，不保存原始错误消息或用户内容。

## 原生回归

```sh
cargo run --manifest-path src-tauri/Cargo.toml --example overlay-display-regression --locked
```

该程序创建两个不可见测试窗口并调用生产代码相同的转交函数，不初始化凭据、不加载主界面、不调用模型，不改变系统显示设置。

通过项：

- 转交后原宿主仍有内容视图，目标窗口持有同一个原内容视图。
- 隐藏宿主承受 20 轮 resize / backing-property 回调后正常退出。
- 两个不可见测试窗口分别定位到本机三块现有屏幕，宿主 backing scale 实际覆盖 2×、2×、1×，无 panic。
- 153 项 Rust 测试通过，23 项默认忽略。
- Mac app 构建和签名 / 麦克风 entitlement 检查通过。

反例参数 `--empty-content-control` 只在这个独立示例中恢复旧行为。执行一次后以 134 退出，日志明确在 Tao `window_delegate.rs:84` 报 `Option::unwrap() on None`，随后 `panic in a function that cannot unwind`。用户之后提供的 14:15 报告进程为该示例，是这次反例测试产生的报告，并非修复版主应用再次崩溃。不要在日常验收或 CI 中反复运行该反例；它会弹出系统崩溃报告。

未将不可见测试窗口的验证当作真实用户拖动、显示器拔插、休眠唤醒的长期稳定性验收。上述场景需要持续观察。
