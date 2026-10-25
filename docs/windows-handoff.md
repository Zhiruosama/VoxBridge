# Windows 开发交接

[开发与打包](development.md) · [整体架构](02-architecture.md) · [内部流程](internal-flows.md)

核对日期：2026-10-25。代码基线：`8b98903`（0.2.1 发布后的 main，已增加本机诊断日志）。本文件是适配计划，不代表 Windows 功能已经通过验收；本轮只整理文档，不实现 Windows 功能。

## 开发安排与首版范围

推荐在真实 Windows 电脑上运行 Codex、检出同一个仓库，承担 Windows 实现和调试；macOS 保留现有功能的回归验证。无需重写项目或复制一份独立产品。建议先建 `codex/windows-support` 分支，避免两台电脑同时修改 main；完成一个阶段后同步提交再做另一端回归。

首版建议以 Windows 11 x64 为验证目标，完整链路是：

1. 选择 Chrome / 其他应用，识别其声音并显示翻译字幕。
2. 打字或录音输入，翻译、生成语音，通过指定输出设备播放。
3. 接入虚拟音频设备，让 Discord 等应用读取生成语音；独立控制本机试听。
4. 普通用户通过安装包安装，在重启后保留配置和密钥。

具体 Windows 版本、架构、麦克风与耳机型号，到 Windows 机器上读取后记录。不要将 Windows 11 的第一阶段验收写成所有 Windows 版本支持。

## 现状与主要缺口

| 部分 | 当前代码状态 | Windows 工作 |
| --- | --- | --- |
| React 界面、中文/英文、设置 | 共用代码 | WebView2 视觉与交互回归 |
| 翻译、Qwen ASR、MiniMax / HTTP TTS | 大部分为共用 Rust 供应商适配器 | 实机验证网络、取消、延迟和音频输出 |
| 发送队列 | 共用前端队列，最多 10 项、2 个准备任务，输出串行 | 保持顺序、取消与失败恢复语义 |
| 实体麦克风录音 | 非 macOS 有 CPAL 路径，录音上限 60 秒 | 权限拒绝、格式、蓝牙切换与热插拔验证 |
| 试听和指定设备播放 | 非 macOS 有 CPAL 路径 | 当前输出 ID 使用设备名，需稳定端点 ID 与迁移策略 |
| 应用声音采集 | 非 macOS 分支明确返回“尚未接入” | 新增 WASAPI 应用进程树采集，适配现有监听流水线 |
| 实时监听与恢复 | 多处仍受 macOS cfg 限制、直接依赖 native Capture | 抽离平台边界，不能只新增一个 Windows 文件 |
| 虚拟麦克风 | 只有 macOS AudioServerPlugIn 与 pkg | 选择 Windows 路由方案；mac 驱动不能直接复用 |
| 悬浮窗 | 通用 Tauri 窗口 + macOS 专用 NSPanel | 置顶、焦点、拖动、透明、DPI、多屏和全屏实测 |
| 密钥、诊断日志 | 共用本机文件实现；Unix 权限只在 Unix 生效 | 检查 Windows 用户目录 ACL，评估 DPAPI，禁止承诺已实现 |
| CI / 发布 | Check 有 Windows Rust 测试；Release 只构建 macOS DMG | 加 Windows 安装包及干净机器验证 |

[2026-10-22 Windows 记录](validation/2026-10-22-windows.md)仅验证了早期版本的构建、独立启动和部分 UI。其旧测试数量、旧方案和通过项不能当作当前主分支实机验收。

## 关键技术选择

### 应用声音采集

优先评估 Microsoft 的 Application Loopback：按目标进程及其子进程采集，适合 Chrome 的多进程架构。官方示例要求 build 20348 或更高，不能因为 Tauri 可以启动就承诺普通 Windows 10 22H2 也支持这条路径。低版本应显示明确的能力限制，或另行设计降级方案，不能偷偷改成采集整个系统声音。

需要补齐：应用分组与稳定身份、音频子进程归属、进程重启后重新绑定、静音数据与时间戳、采样率/声道转换、缓冲与背压、取消时释放 COM/音频客户端。不能依赖旧 PID，不能把麦克风声音冒充应用采集。

平台采集适配器应输出统一音频数据与统计信息，继续使用现有 ASR、分句、翻译和恢复逻辑。先梳理当前接口再决定抽象，避免复制整套字幕业务。

### 虚拟麦克风：单独的一项工程

WASAPI 采集与播放本身不会创建能被 Discord 选择的麦克风端点。

建议分两阶段讨论与实施：

- 功能验证阶段：用户自行安装已有 Windows 虚拟音频设备，VoxBridge 选择其播放端点，Discord 选择对应录音端点。核对供应商的安装及许可条件，不默认有权把第三方驱动打进安装包，也不保证设备名称是 VoxBridge。
- 完整产品阶段：独立实现/集成可分发的 Windows 虚拟音频驱动，提供名为 VoxBridge 的录音端点；处理驱动签名、安装升级卸载、Secure Boot 兼容与端点枚举。Microsoft SYSVAD 可作为研究参考，不是拿来即可发布的音频线。

Windows 内核驱动有独立签名与分发要求；普通 exe 签名不能代替驱动签名。不要把关闭驱动签名强制或关闭 Secure Boot 作为同学安装首版的正常步骤。

### 默认设备与路由

保留 `__system_default__` 的动态解析语义。明确“系统默认”采用多媒体还是通信角色，且 UI、录音与试听采用一致策略。显式选择的设备消失时需给出状态，不要默默把待发送语音播到外放。使用 Windows 端点 ID 区分重名设备；对旧设备名配置设计迁移或重新选择流程。

本机试听和虚拟设备输出是两条独立路由，关闭试听仍可输出给聊天应用。测试时不要修改用户系统默认输入。

## 源码入口与不能破坏的契约

| 入口 | 说明 |
| --- | --- |
| `src/App.tsx`、`src/bridge.ts` | 界面协调与 Tauri IPC；保持音频帧在原生端，不经 WebView 传送 |
| `src/core/send-queue.ts`、`src/core/composer.ts` | 多条准备、串行播放；同语种跳过翻译；输入框忙时仍可编辑 |
| `src/core/session.ts`、`src/core/listening.ts` | session / generation / revision 防止旧结果覆盖，停止监听有排空逻辑 |
| `src-tauri/src/capture.rs` | 当前 native 路径指向 macos_capture；源枚举与诊断采集的非 macOS 分支未实现 |
| `src-tauri/src/capture/listening.rs` | HTTP / realtime / recovery 模块及多个处理函数仍由 macOS cfg 包围 |
| `src-tauri/src/capture/listening/realtime.rs` | 直接调用 native::Capture；需要接入统一平台接口 |
| `src-tauri/src/capture/listening/recovery.rs` | 直接使用 mac 应用/进程源枚举，Windows 应实现自己的重绑定身份 |
| `src-tauri/src/platform/macos_capture.rs`、`platform/macos/` | macOS 行为参考，保留原有平台实现 |
| `src-tauri/src/platform/mod.rs`、`microphone.rs` | CPAL 设备、输出、录音；非 macOS 权限函数直接返回 Ok，不能视为 Windows 已授权 |
| `src-tauri/src/asr.rs`、`asr/realtime.rs`、`providers.rs` | 共用 ASR、翻译与错误处理，不应重写供应商业务 |
| `src-tauri/src/speech.rs`、`speech/streaming.rs`、`speech/prepared.rs` | 流式 PCM、准备缓存、AudioGate、取消与输出，保留有界资源 |
| `src-tauri/src/overlay.rs`、`overlay/voice.rs`、`overlay/panel.rs` | 浮窗通过主窗动作/快照复用同一队列；NSPanel 为 macOS 专属 |
| `src-tauri/src/diagnostics.rs`、`diagnostics/writer.rs` | 有界 JSONL 日志与导出；只允许固定元数据，禁止追加字幕、密钥、音频或任意错误字符串 |
| `src-tauri/src/lib.rs`、`src-tauri/build.rs`、`src-tauri/capabilities/` | 新命令必须同时注册、生成权限并配置最小 capability；浮窗不可直接读取凭据 |
| `src-tauri/tauri.conf.json`、`scripts/`、`.github/workflows/` | 构建与分发；mac 资源与签名脚本目前仅在 darwin 执行 |

稳定行为：已翻译字幕不要因后续识别修订而消失；发送成功清空已提交草稿但不能清空随后输入的新草稿；配置每项入队时快照，不能把切换音色影响到已经准备的任务；取消后的旧回调不能再次播放。中英文界面切换只改变显示文案，不能随意改供应商协议中的语言值。

## Windows 起步步骤

原生 Windows 环境运行，不用 WSL 代替 Windows 音频与桌面调试。先安装 Git、Node.js 24、Rust stable（MSVC，满足项目 1.96 最低要求）、Microsoft C++ Build Tools 的 C++ 桌面开发组件及 Windows SDK、WebView2 Runtime。WDK 只在进入自有驱动阶段时再准备。

PowerShell，在干净检出中执行：

```powershell
git clone https://github.com/Zhiruosama/VoxBridge.git
cd VoxBridge
git switch -c codex/windows-support
npm ci
npm run format:check
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked -- --test-threads=1
npm start
```

`npm start` 会自动启动 Vite，不要再启动第二个占用 1420 端口的服务。纯浏览器预览不能验收原生功能。可用以下命令检查内嵌前端的独立程序：

```powershell
npm run desktop:build -- --debug --no-bundle
# 关闭开发服务后启动 src-tauri/target/debug/voxbridge.exe
```

独立程序通过后再验证 `npm run desktop:build -- --bundles nsis`。此命令是后续验证入口，不表示当前已验收安装包。安装器需明确 WebView2 策略、升级与卸载行为；不把 Rust、Node 或开发密钥作为用户依赖。先不要推新发布标签：现有 Release 工作流只上传 macOS，需要 Windows 任务与附件校验后再发布。

## 实施顺序与完成标准

1. **建立实机基线**：记录 Windows build/架构、设备和 WebView2；跑测试与独立 exe；验证现有打字→翻译→TTS、本机试听、密钥保存重启、麦克风录音。失败先定位，不把模拟请求作为实机结果。
2. **完成应用监听**：抽离 native Capture 接口、接入 WASAPI 进程树；Chrome 播放已知短片验证字幕。其他应用播放声音不能混入；验证停止/重新开始、Chrome 重启、断网恢复、长时间监听和资源释放。
3. **打通聊天输出**：先确定第三方虚拟设备方案；无通话时测试音回录，核对无丢帧、失真、串音；用户明确开启测试后做 Discord 网页/客户端与朋友对端测试。QQ、微信逐个验收，不能由 Discord 可用推断全部可用。
4. **平台体验与安装包**：100%/125%/150% DPI、中英文深浅色、滚动/选择/快捷键、中文输入法 Enter 不误发送；浮窗拖动、按钮命中、多屏、Alt+Tab、全屏、关闭与最小化；普通账户、干净机器安装/重启/升级/卸载。
5. **独立 VoxBridge 端点**：若要求安装后一站式出现 VoxBridge 麦克风，再推进自有驱动及签名分发。这个范围独立验收，不藏进 UI 适配中。

每阶段补充真实测试环境、通过/失败/未测项及日志，不按旧测试数量写结论。共享改动需在 macOS 回归，Mac 专用修改避免被 Windows cfg 调整误伤。CI 构建通过不能代替真实音频设备验收。

## 隐私、协作与调试约束

- 不复制或提交 macOS 工作区的 `密钥-不可提交/`、用户配置、录音和克隆源文件。Windows 用户自己填测试密钥，避免传输整份私有目录。
- 普通设置与密钥需要重启持久化；当前加密材料和密文均在本机目录，不能宣称抵御同用户恶意程序。Windows ACL/DPAPI 设计应记录迁移与失败恢复。
- [诊断日志](diagnostics.md)只记录阶段、耗时、错误分类和相关 ID，导出不带请求正文或凭据。日志目录路径用 Tauri API 获取，不硬编码 macOS 路径。
- 不改变系统默认麦克风；不代用户发起通话。测试音可能进入已有通话，先确认环境。付费 ASR/TTS 测试限定次数，不重新克隆音色。
- 当前 macOS 工作区中 `docs/README.md`、`docs/11-streamvox-reverse-engineering.md`、`docs/research/` 有用户未提交的研究内容，不应顺手覆盖或提交。
- 文档没有授予远端推送权限。Windows 会话按用户对该会话的授权提交/推送；建议先推工作分支供回归，不直接改已有发布标签。

## 可给 Windows Codex 的起始任务

> 阅读 docs/windows-handoff.md、docs/02-architecture.md、docs/internal-flows.md 与当前仓库指令。先读取 Windows 版本和设备环境，建立当前主分支的构建及真实录音/播放基线，记录通过与未测项；再提出应用声音采集的最小平台接口改动。保留现有 macOS 行为与发送队列、权限和日志隐私边界。本轮不要开发自有虚拟驱动、改变系统默认设备、发起通话或发布版本。实际音频与供应商测试前说明范围和费用；私有密钥不输出、不提交。

## 官方参考

- [Tauri Windows 开发依赖](https://v2.tauri.app/start/prerequisites/)
- [Tauri Windows 安装包与 WebView2](https://v2.tauri.app/distribute/windows-installer/)
- [Microsoft Application Loopback 示例与最低 build](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/)
- [Microsoft SYSVAD 示例](https://github.com/microsoft/Windows-driver-samples/tree/main/audio/sysvad)
- [Microsoft Windows 驱动签名](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/windows-driver-signing-tutorial)
