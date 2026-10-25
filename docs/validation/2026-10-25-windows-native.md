# Windows 原生采集与独立程序验证

日期：2026-10-25（Asia/Hong_Kong）。基线 `4d5efa7`，工作分支 `codex/windows-support`，未发布。

## 本批实现

- 保留共用前端的布局、设置、字幕、发送队列与浮窗，仅将应用监听的 Mac 平台判断改为后端 `nativeCapture` 能力判断。
- 增加 `platform/capture.rs` 采集边界，macOS 继续使用原来的 Core Audio 实现；Windows 使用 WASAPI Application Loopback 采集选中进程及其子进程。
- Windows 采集在自有 MTA 线程处理异步激活、事件等待、48 kHz stereo PCM16、有界 PCM 缓冲、静音与断点、失败和取消释放；音频不经过 WebView。
- Windows 来源携带可执行文件路径的 SHA-256 与进程创建时间。启动时核对身份，恢复时先核对原进程实例，再接受唯一的同应用候选；拒绝同名程序猜测和歧义重绑定。
- HTTP 与实时 ASR、字幕提交、翻译排队、会话/代次隔离、8 秒收尾和有界重试使用原有共用逻辑，不维护另一套 Windows 业务实现。
- Windows 输出标识改为 CPAL 提供的原生端点 ID，旧设备名要求重新选择；默认输出仍动态解析，不把断开的显式输出回落到扬声器。
- 增加 Windows NSIS 中英文语言选择、打包入口和 CI 构建产物；未修改自动发布工作流，也未打新标签。
- 格式检查接受现有 LF/CRLF，解决 Windows 检出的检查失败；诊断队列的大对象改为 Box，日志格式及隐私白名单不变。

## 环境

Windows 11 家庭版中文版，10.0.26200 x64；Node 24.14.1、npm 11.11.0、Rust 1.96.0；WebView2 155.0.4283.62。音频端点包含 Realtek 麦克风阵列/扬声器和 Steam Streaming 设备。

## 自动检查与构建

| 检查 | 结果 |
| --- | --- |
| `npm run format:check` | 通过 |
| `npm test` | 16 个文件、161 项通过 |
| `npm run build` | 通过；保留现有大于 500 kB 的分块提示 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 通过 |
| `cargo test --offline --manifest-path src-tauri/Cargo.toml --locked -- --test-threads=1` | 133 通过、0 失败、17 手动项默认跳过 |
| `cargo clippy --offline --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings` | 通过 |
| Windows 应用来源和输出端点只读实机测试 | 2 项通过；端点可重复枚举并精确解析 |
| `npm run desktop:build -- --debug --no-bundle` | 通过 |
| 独立 exe 启动 | 保持运行、创建标题为 VoxBridge 的窗口；1420 端口没有开发服务器；随后关闭本轮测试进程 |
| `npm run desktop:build:windows -- --debug` | 通过，生成约 9.30 MiB 的 NSIS 测试安装包 |

程序：`src-tauri/target/debug/voxbridge.exe`。安装包：`src-tauri/target/debug/bundle/nsis/VoxBridge_0.2.1_x64-setup.exe`。均为本地 debug 测试产物，未签名发布、未提交到仓库。窗口启动检查不等于完整 GUI 验收。

NSIS 首次官方下载超时；随后从相同 GitHub 官方 release 的 asset API 获取 NSIS 3.13 与 Tauri 插件，核对 release 的 SHA-256 后补齐本机 Tauri 工具缓存，再次打包成功。没有改用第三方镜像或绕过打包器校验。

## 实际音频检查

全部使用程序生成的受控测试音/静音，仅采集测试进程。没有打开麦克风，没有录制用户应用，没有调用外部模型、安装音频驱动、修改系统默认设备或发起通话。

1. **进程树、隔离和 20 次启停：通过。** 选中的父进程自身不播放，子进程输出测试音；另一个无关进程同时输出测试音。每轮验证目标静音、无关进程正对照、目标子进程非零声音、回到静音、取消和销毁后无新帧。
2. **激活过程中取消：通过。** 20 次不同短延时取消初始化，清理后无继续写入；异步激活参数由完成回调持有，取消后仍保持有效。
3. **自身输出隔离：通过。** VoxBridge 测试进程输出声音时，选定目标保持静音；随后目标发声正对照通过。记录的静音峰值约 `1/32768`，目标峰值约 `0.0387`。
4. **真实采集 → 本地模拟 ASR/翻译 → 断线恢复：通过。** 两次采集生命周期、重建 WebSocket、提升 generation、不同字幕 ID、恢复后的 final 和对应翻译均通过。模拟服务验证的是原生采集与共用业务连接，不代表真实语音识别质量。

执行入口（硬件测试均需显式调用）：

```powershell
cargo test --offline --manifest-path src-tauri/Cargo.toml --locked windows_ -- --ignored --nocapture --test-threads=1
cargo test --offline --manifest-path src-tauri/Cargo.toml --locked capture::test_audio::live_ -- --ignored --nocapture --test-threads=1
cargo test --offline --manifest-path src-tauri/Cargo.toml --locked live_native_capture_reconnects_and_releases_old_attempt -- --ignored --nocapture --test-threads=1
```

## 开发中发现并修正

- 原型中 Windows `PROPVARIANT` 的自动析构错误释放了借用的激活参数，触发堆损坏。已对借用视图使用 `ManuallyDrop`，并用回调持有的 `Arc` 保证取消后的参数生命周期；后续全部硬件与取消测试通过。
- Windows shared-mode PCM16 转换的静音有一个量化单位的底噪。硬件 fixture 的 Windows 静音阈值调整为两个量化单位；Mac 原阈值保留，目标声音仍必须大于 `0.01`。
- 两项旧 fixture 依赖端口拒绝耗时或“发送 partial 后立即断线”的调度顺序，Windows 暴露出不确定性。改为主动握手拒绝，以及确认 partial 已到达后再模拟断线；业务的取消与旧代次丢弃语义保持不变。

## 尚未验收 / 尚未交付

- Chrome、Discord、微信等真实应用的声音、中文/长句和真实云服务质量、费用、延迟。
- Windows 自有 VoxBridge 虚拟麦克风驱动；当前内置安装按钮仍只安装 Mac 驱动。Windows 聊天输出需另装可用的虚拟音频设备，再选择其播放端点，尚未验证本机 Steam 端点能否充当音频线。
- 真实麦克风、隐私拒绝、蓝牙/USB 热插拔、睡眠唤醒、多实例应用重启与长期稳定性。
- Windows DPAPI/目录 ACL 的专项加固；本批沿用现有本机凭据存储，默认持久化测试通过不等于完成同用户隔离。
- 浮窗 DPI/多屏/全屏、中文输入法与全部 GUI 操作。
- 干净机器安装、普通账户、升级和卸载；当前只验证安装包生成，没有把本机现有安装替换为测试包。
- macOS 编译和实机回归（本机无法执行）；共用接口必须经 Mac CI/实机确认后再合并或发布。

下一批工作按 [Windows 开发待办](../windows-development-todo.md) 推进：真实应用与服务闭环、虚拟设备路由、设备/权限恢复、凭据保护及安装体验。

## 后续修复：旧输出设备配置迁移

用户实测发现旧版设备名配置被新标识校验拒绝。现已补充 Windows 启动迁移：枚举端点后，仅当旧名称完全匹配唯一 Windows 输出设备时转换为稳定 ID，并持久化；不改变其他设置。设置页打开/刷新时也会迁移可唯一匹配的草稿，等待用户保存。默认设备、空路由、已保存的稳定 ID、Mac ID、名称重名或设备缺失均不自动改选。

新增 5 项回归覆盖双路迁移、重名/断开/大小写不匹配、不误改稳定 ID、重复枚举、幂等及保存后重新加载；前端共 166 项通过。此修复替代上文“所有旧设备名要求重新选择”的初始行为，无法唯一匹配时仍需手动选择。

### 第二次定位：完整设备名与短名称不一致

用户仍复现旧名称错误。检查已保存的音频路由字段与 CPAL 0.17 WASAPI 枚举实现后确认：旧值是“扬声器 (Realtek(R) Audio)”等完整 FriendlyName，新版 `description().name()` 优先返回 DeviceDesc（可能只有“扬声器”），完整名则在 `extended()` 中。此前前端按名称精确迁移因此无法匹配。

已修正 Windows 设备显示名来源，恢复完整 FriendlyName；后端也接受唯一精确匹配的旧名称，遇到空值、重名、缺失或其他平台 ID 时明确拒绝。设备等待函数返回解析后的稳定 ID，后续播放使用同一个 ID，避免等待结束后按名称再次匹配到不同设备。Mac 的设备名与解析策略保留。

本机只读实测验证三个完整名称（Realtek、Steam Streaming Speakers、Steam Streaming Microphone）的旧名称解析、稳定 ID 解析及等待返回值一致；没有播放或采集用户声音。另补模拟回归覆盖完整名称、歧义、缺失、默认及稳定标识。

同时将 ASR 诊断中的模型名称从 11px 等宽字体改为界面统一字体、13px；诊断页按 `nativeCapture` 能力启用，不再将 Windows 错误显示为“仅支持 Mac”，并修正采集范围说明及英文翻译。

## 应用选择列表整理

原 Windows 来源使用可见窗口标题，混入硬件辅助窗口、系统外壳、输入法、调试终端与网页标题。现改为应用名称：先筛选正常主窗口，排除工具/附属/隐藏窗口和已知系统、硬件、命令行辅助程序，再沿同一可执行文件的父子关系归并到应用根进程。父进程创建时间必须早于子进程，避免 PID 复用导致错误扩大采集范围。

显示名取文件产品信息，Edge、Oopz、KOOK 等使用简洁名称，缺少产品信息时回退为可执行文件名，不使用窗口标题或完整路径。多个窗口属于同一根进程时只显示一次；同名但独立的实例分别保留编号，仍采集所选实例的进程树，不将其他实例的音频混入。

本机只读枚举结果为 `Codex`、`Edge`、`Oopz`，其来源身份均可精确重新读取；截图中的 AsHDRControl、AsHotplugCtrl、Program Manager、输入体验、PowerToys 工具窗与调试路径不再出现。KOOK 未在本机运行，名称映射通过纯逻辑测试，运行后仍需用户确认。前端 166 项、Rust 默认 136 项通过；新增回归覆盖应用名称、辅助程序过滤、同应用根进程归并及父 PID 复用。

用户已明确授权后续每批验证完成后自行 commit 和 push；当前使用 `codex/windows-support` 工作分支，不直接推 main 或修改发布标签。

## 试听模糊、金属感与拖尾：同端点重复播放

用户反馈人声不清晰、有电子感，偶尔拖延。检查非敏感路由字段发现：发送时试听已开启，试听为系统默认，发送为 Realtek 扬声器的显式端点。只读实机解析确认二者实际是同一设备。原逻辑只比较配置字符串，因默认别名与显式 ID 不同而创建两路独立播放，可能产生时差叠音、金属感和拖尾。

主输出现在在打开实际设备时保留其稳定端点 ID；流式与完整缓冲播放共用这一身份。试听端解析默认别名/旧名称后按真实端点 ID 判断：相同则不打开第二路输出，也不报告设备故障；不同设备继续正常试听，试听故障仍不影响发送。没有改动用户设备选择、TTS 音色、语速或系统音频设置。

默认 Rust 137 项通过、18 手动项跳过，严格 Clippy 通过。新增回归覆盖同端点不打开、不同端点照常打开及故障传递；显式执行的只读测试确认系统默认与 Realtek 显式端点相同，试听分支没有输出流。未调用收费供应商或录制用户音频。此记录验证重复播放修复，不代表所有音色听感或网络时延均已验收，最终听感由用户重试确认。

## Windows 测试版启动时的控制台窗口

原入口只在非 Debug 构建设置 Windows GUI 子系统，本地一直交付的 Debug 测试程序因此仍是 Console 子系统，会随启动出现终端。已改为 Windows 上所有构建均使用 GUI 子系统；应用的 JSONL 诊断日志不依赖终端输出，保留原有记录和导出功能。验证时检查生成 exe 的 PE 子系统字段，并在无开发服务器情况下重新启动应用。

实际结果：修改前 PE 子系统为 `3`（Console），修改后为 `2`（Windows GUI）；格式检查、桌面构建和 NSIS 打包通过，新版启动并保持 VoxBridge 窗口运行。

## Windows 虚拟麦克风：VB-CABLE 首版接入

用户选择先使用官方签名的基础版 VB-CABLE。Windows 设置页现提供固定安装器入口、独立的播放/录音两端检测、部分就绪提示、稳定发送端点快捷选择和聊天软件 CABLE Output 指引。首次安装须在厂商窗口点击 Install Driver，按厂商要求重启电脑；不静默安装或自动重启。虚拟录音端从 VoxBridge 的实体录音列表与默认录音选择中排除，防止回采自身输出。试听继续使用原有独立路由和同端点去重。

构建从官方固定地址获取 Pack45，核对 ZIP SHA-256、31 个原包文件摘要与 x64 安装器有效 Authenticode 签名（BUREL VINCENT）。安装入口在提权前再次校验全部文件。原始包包含的 readme、许可证与驱动保持不变，UI 和 Windows 说明保留 VB-Audio 来源与 Donationware/捐赠提示；依据厂商当前官网基础包分发条款，不包含 A+B/C+D。

验证：前端 166 项通过；Rust 默认 138 项通过，另外显式运行资源/只读库存检查通过，覆盖完整包可用、缺失包拒绝、篡改文件拒绝。严格 Clippy、格式检查、前端构建及 Windows Debug/NSIS 构建通过，安装包约 9.96 MiB。检查生成的 NSIS 脚本与 exe 相邻资源目录，31 个文件均正确包含且摘要一致。

只读本机检测返回 `provider=vb-cable, output=null, inputName=null, partial=false`：当前机器尚未安装 VB-CABLE，没有把 Steam 设备误报为就绪。尚未执行驱动安装、重启、音频回录或聊天通话；真实链路与音质需用户安装后继续验收。本批不将 W4 的真实收音标准或 W7 的自有驱动标为完成。使用步骤见 [Windows 虚拟麦克风说明](../../native/windows/README.md)。

## CI 资源准备顺序修复

Check 的 Windows job 在 Rust 测试阶段失败，macOS 与前端通过。原工作流只在测试前构建 macOS 驱动；Windows 的 VB-CABLE 资源直到后面的桌面打包钩子才准备，导致全新 runner 的 Tauri build.rs 提前校验资源时失败。本机缓存掩盖了这个依赖。

临时移走源资源目录后执行同样的 locked Cargo 构建，复现 `resource path ... VBCABLE_Driver_Pack45 doesn't exist`；目录已在 finally 中恢复。工作流改为两个平台都在 Rust 编译/测试前运行统一 `build-desktop-resources.mjs`。独立空目录验证 Windows 官方包首次下载、摘要与签名校验成功，再按修正后的顺序运行资源准备、rustfmt 和完整 locked Cargo 测试，138 项通过、19 项手动测试跳过。本批仅修改 CI 与验证记录，应用行为及安装资源内容未变。
