# 当前开发指南

## 当前可用功能

- React / TypeScript 工作台：深色 / 浅色 / 跟随系统、字幕流、底部输入、设置与诊断。
- 字幕修订、定稿去重与会话隔离的核心逻辑及自动测试；按用户反馈已移除界面的固定字幕示例。
- ASR / 翻译 / TTS 分阶段保存多个 profile，手动填写地址、模型与音色。非敏感配置位于当前 WebView 的 localStorage，不包含密钥和字幕历史。
- Rust 后端通过系统凭据存储保存密钥：macOS Keychain / Windows Credential Store。已有密钥不会被读取回前端；本批 Qwen ASR 手动验证已通过隐藏输入把凭据保存到 Mac Keychain，GUI 保存 / 读取、重启恢复和删除仍待验收。
- OpenAI-compatible Chat Completions 文字翻译：本机后端调用、超时、响应大小限制、停止与取消、对常见错误分类。当前采用非流式完整译文，后续按需求扩展流式翻译。
- 输出设备诊断：用户选择设备后，显式播放约 1 秒的低音量测试音并可停止。不执行任何自动系统默认设备切换。
- TTS：MiniMax WebSocket 与 OpenAI-compatible `/audio/speech`；内存有界接收、解码后试听 / 指定设备发送、停止。两种协议通过本机模拟服务测试；MiniMax 真实合成 / 解码已有 Windows 验证记录，实际播放与 Mac 路由待验收，详见 [TTS 开发说明](10-speech-backend.md)。
- 独立 Swift 原生采集探针已在 Apple Silicon Mac 完整构建并通过 ad-hoc 签名校验；权限 / 采集尚未验证。
- Mac 桌面诊断已接入目标 PID / bundle 选择与 Core Audio tap，直接原生 IOProc 写入有界 stereo Float32 PCM 环形缓冲。诊断模式只显示 RMS、帧数及丢帧，不保存或上传音频。
- 主窗口已接通显式 HTTP 分段监听：指定进程采集 → 16 kHz mono PCM16 短句 → Qwen HTTP ASR → 短句翻译 → 对应双语字幕。仅用户点击开始才采集并上传，未做真实声音端到端验收；不等于实时 WebSocket 或流式 partial 已完成。
- 已接入 Qwen HTTP 短音频 ASR：语音识别设置可选择独立预设，诊断页显式上传 0.1–30 秒、16 kHz 单声道 PCM16 WAV，结果返回文本与输入时长。单任务互斥、提前 / 请求中取消、响应大小限制及错误脱敏均有回归；不是实时音频输入。

## 尚未实现

实时 WebSocket ASR / partial、自适应语音端点与低延迟调度、TTS 边接收边播放、独立悬浮窗、Windows 稳定设备 UID、睡眠 / 断连恢复、用量估算、诊断导出、麦克风翻译。未接入能力的按钮明确禁用并提供原因；不放置伪造的监听状态。当前不等于 M1 音频闭环或 M2 端到端原型完成。

## 开发准备

使用 Node.js 24（最低 22.12）与 Rust stable 1.96+。`package-lock.json` 与 `src-tauri/Cargo.lock` 已入库。Rust 工具链文件选择 stable；若未来更新 stable 造成不兼容，应固定经验证的版本后更新记录。

桌面依赖遵循 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)：Mac 准备 Apple Command Line Tools；Windows 准备 C++ Build Tools 与 WebView2。暂不支持 Linux 桌面，不能在 Linux 上依赖 Keyring 的默认 mock 后端作为安全存储。

```sh
npm ci
npm start
```

默认启动桌面应用窗口。`npm run desktop` 是相同的开发入口；开发模式自动运行 Vite，因此不要另起一个占用 1420 端口的预览进程。

正式桌面构建会嵌入界面资源，不依赖开发服务器。Mac 上构建 `.app` 和 `.dmg`：

```sh
npm run desktop:build:mac
```

结果位于 `src-tauri/target/release/bundle/macos/` 和 `bundle/dmg/`。2026-10-23 已在 macOS 26.4 / Apple Silicon、Node 24.18.0、Rust 1.99.1、Swift 6.3.3 环境完成前端格式 / 测试 / 构建、Rust 格式 / 默认测试 / 严格 Clippy，以及独立探针构建 / 临时签名校验。使用 `npm run tauri -- build --bundles app` 构建了约 18.51 MiB 的 `VoxBridge.app`，并确认 arm64 可执行文件与 Info.plist 有效。未运行应用、采集或播放，未构建 `.dmg`，未验收发布签名、公证或干净环境安装；不把构建通过等同于 M1 闭环。Rust 由本机官方安装器提供；本轮未修改 shell 配置，若 `cargo` 不在 PATH，请先在终端加载 `~/.cargo/env`。

需要开发时单独检查界面，可使用 `npm run dev` 打开 `http://127.0.0.1:1420`；这不是产品交付形态。`npm run build` 只构建前端；`npm run desktop:build` 按当前平台生成应用 / 安装程序。只浏览界面无需 BlackHole；只有后续虚拟路由测试才需要安装。

主界面仅保留字幕与输入。设备测试位于 **设置 → 音频与诊断**；字幕示例区已移除。诊断页的“试听输出设备”与常规设置共用同一配置，修改后点击“保存更改”；发送设备仍独立设置。保存提示使用圆角浮层，不占页面布局空间。真实监听仍禁用；桌面版可配置 TTS 后试听和发送语音。

设置工作区左侧按常规、文字翻译、语音识别、语音合成、音频与诊断分类。常规页提供主题、试听 / 发送设备、设备诊断入口和版本信息；模型页采用连接与凭据两个分组。普通配置统一点击“保存更改”，密钥仍独立保存。同一设置工作区切换分类保留草稿，离开工作区会放弃未保存内容。

本批 Mac 自动验证：前端 33 项测试、Rust 20 项默认测试通过，3 项真实服务手动测试保持忽略。新增回归覆盖普通配置保存前拒绝含认证 / 查询 / 片段的 URL、空分隔符、非活动配置和失败时不写存储；空地址 / 模型 / 音色草稿仍可保存。非空地址必须有效且使用对应安全协议，本机允许匹配的 HTTP / WS。旧版已保存的不安全或错误地址会使加载失败并回退默认设置，原 localStorage 不会自动清除；本修复不代表清理了历史磁盘凭据。TTS 终态依据合成与播放合并结果分类，真实返回错误优先于清理取消；回归使用模拟任务，不替代真实播放中停止验收。

Windows 已额外验证内嵌资源的独立开发程序：关闭开发服务器后仍可启动。当前本地输出为 `src-tauri/target/debug/voxbridge.exe`；这是用于验证的开发构建，不是正式安装包。发布构建继续使用上述桌面打包命令。

## 测试翻译

1. 在桌面版设置 → 文字翻译中填写服务根地址，例如 `https://服务地址/v1`，不含 `/chat/completions`。
2. 填写供应商真实支持的模型 ID，单独保存其 API Key，再保存设置。
3. 回到工作台，选择语言，输入短文本，点击“翻译”。此操作会将文本发送给配置的服务，可能计费。
4. 检查译文，测试停止和错误提示。没有 Key 时明确失败，不退回虚假译文。

兼容协议是 Chat Completions，不是任意“OpenAI 格式 Key”；没有模型列表的服务也可使用。每次任务使用当前配置快照，运行中的任务不因设置变化改变地址。

## Qwen ASR 接入与验证

2026-10-23：用户授权在其提供的 `https://maas.qianwenaiapi.com/compatible-mode/v1` 使用少量合成语音测试，并允许试其他模型。核对[平台 Qwen-ASR 文档](https://platform.qianwenai.com/docs/api-reference/speech-recognition/qwen-asr/api-reference)后，使用 `POST /chat/completions`、`messages[].content[].input_audio.data` 的 `data:audio/wav;base64,...`、`stream:false`；返回文本位于 `choices[0].message.content`。此协议提交完整音频，文本结果流式返回不等于实时音频输入。

- 同一网关的 `qwen-audio-3.0-asr-flash` 对本次兼容 HTTP 请求返回 HTTP 400；错误不回显上游正文。不能据此断言模型原生 DashScope 接口不可用。
- 同一网关和凭据改用文档列出的 `qwen3-asr-flash`，5.09 秒合成英文语音成功转写，请求耗时 1368 ms，保留了 speech recognition test 和会议时间等内容。只验证这一短英文样例，不是中文准确率、p95 或真实音频端到端延迟。
- 凭据通过系统隐藏输入管道传给手动测试标准输入，保存至 Keychain 的 `provider-qwen-asr`；未写入命令行参数、源码、普通配置或报告。没有自动转发到其他域名。测试音频由系统语音合成生成，位于 Git 忽略的 `native/macos/.build/asr-sample.wav`，不是用户录音。
- `live_qwen_asr_short_audio` 默认忽略，最多尝试上述两个模型，仅在用户明确授权后运行。常规测试不访问真实凭据、不请求付费接口。
- 本批前端 39 项、Mac Rust 38 项默认测试通过，默认忽略 6 项手动测试；格式、严格 Clippy、前端生产构建及 `.app` 构建通过。GUI 文件转写、中文、真实捕获到识别、实时 WebSocket 和 Windows 行为未验收。

使用步骤：重启最新桌面应用，在设置 → 语音识别 → 新增配置选择“Qwen ASR · HTTP 短音频”，保存更改。此 Mac 已保存同 ID 的凭据；其他机器需独立保存密钥。进入音频与诊断 → ASR 短音频验证，选择 0.1–30 秒、16 kHz 单声道 PCM16 WAV，再显式点击“发送音频并识别”。动作将上传所选音频并可能计费；停止或离开页面取消当前请求，不自动切模型或重试。主窗口已启用 HTTP 分段监听，真正实时 WebSocket 仍未接入。

## Mac HTTP 分段监听

主窗口使用“刷新进程”读取当前音频 PID；先让目标应用发声，选择对应进程，再点击“开始分段监听”。启动前须保存 Qwen HTTP ASR 和文字翻译两个有效 profile 及各自凭据。点击后会持续采集指定 PID，并把有声短段上传到当前 ASR 服务、将识别文字发送到翻译服务，可能计费；不自动开始，不记录原始音频或字幕到磁盘，不扩大到其他进程。

当前管线：原生 stereo Float32 → mono → 128 抽头窗化 sinc 抗混叠重采样至 16 kHz → 20 ms 能量块 → 短句 PCM16 WAV → Qwen HTTP 转写 → 翻译 → 主窗口 final 双语字幕。简单能量门限 RMS 0.008、200 ms 预缓冲、至少 300 ms 有声、600 ms 静音结束、8 秒强制切段；音乐 / 噪声可能被认为有声，低音量语音可能被忽略，仍需实机调参。当前不是 WebSocket 实时 partial，也不承诺低于原始延迟目标。

- 采集 ring 上限 192,000 stereo 帧，ASR 待处理队列 4 段；队列满时丢新段，入队后超过 20 秒丢弃，界面报告丢帧、跳过段和音频断点，不无限积压。ASR 与翻译串行，先原文后对应译文，按 session / segment / revision 对齐；字幕时间为源音频段起点。8 秒切段和丢弃可能截断语义，后续实时方案再优化。
- PCM 序号不连续时丢弃当前半句并重置转换器，不把缺失前后声音直接拼接。停止时丢弃尚未结束的半句与待处理队列，取消在途 ASR / 翻译，并等待原生采集退出后释放占位。没有自动重试或模型回退；服务 / 网络错误会停止整个监听，原文可保留但对应失败译文不伪造。
- 监听共用采集、ASR 和翻译任务限制；本批为防未验收的数字回环，整个监听期间持有音频互斥许可，禁用 TTS / 测试音。进入设置会先请求停止，停止完成后可再次打开设置；主窗口卸载或正常退出也取消会话。真正同时收发尚待设计与验收，不能把当前互斥当成防回环功能完成。
- 本批前端 40 项、Mac Rust 47 项默认测试、格式、严格 Clippy、前端生产构建和约 18.99 MiB 的 `.app` 构建通过。新增信号测试覆盖 8 / 16 / 44.1 / 48 / 96 / 192 kHz 的时长、1 kHz 频率与幅度、降采样带外抑制、静音、不连续及 8 秒切段；本机 HTTP 模拟验证生产 PCM → WAV → ASR → 关联翻译事件，以及提前取消无字幕、槽位释放、队列满不阻塞。未开启真实采集、未调用付费服务、未验收 GUI / 中文或真实声音端到端；常规测试仍忽略 6 项手动测试。

## 验证命令

```sh
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

默认测试不需要真实密钥，不调用付费服务。Rust 的 HTTP / WebSocket 测试启动回环地址模拟服务；音频测试检查采样值和自行生成的 MP3 解码，不打开扬声器。工作流对前端、Windows / Mac Rust 编译与测试、Mac Swift 探针编译做检查；CI 不验证实际权限或声音。

当前环境的官方 Rust sparse 索引访问较慢，本轮通过命令级 rsproxy 源替换完成依赖下载，没有修改全局 Cargo 配置。默认仓库不绑定该镜像；其他开发机先使用官方源即可。

## Mac 接手步骤

1. 拉取 main，安装依赖并运行上述检查。
2. 启动桌面版，验证配置持久化、Keychain、翻译与输出设备列表。
3. 在设置 → 音频与诊断 → 应用声音采集诊断中，先让目标应用播放声音，手动刷新进程，选择对应 bundle / PID，再点击开始。首次可能请求系统音频录制权限；拒绝或无电平时检查系统隐私设置，允许后重启应用。只采集选定 PID，不自动加入其他子进程或全局声音；最多 60 秒，点击停止或离开诊断页会取消。独立探针仍可按 [Mac 探针说明](../native/macos/README.md) 用于对照。
4. 用真实耳机测试输出，再明确选择 BlackHole 测试；确认聊天软件输入 / 输出路由。
5. 按 [Mac 验证矩阵](06-development-validation.md) 记录通过、失败和未测项。先验收目标发声 / 静音电平、其他应用不混入、拒绝 / 再授权和反复启停，再将原生 PCM 接入 ASR 及服务流水线。

2026-10-23 采集诊断批次：Mac 前端 37 项、Rust 31 项默认测试、格式、严格 Clippy 和约 18.77 MiB 的 `.app` 构建通过。另显式运行只读音频进程枚举，返回 43 个进程且不含当前测试进程；未创建 tap 或打开输入流，不是采集验收。新增回归覆盖 PCM 交错 / 双平面、有限样本清洗、满缓冲丢帧及序号间隙、原生缓冲长度 / 空指针边界、采集会话早停 / 忙碌 / 过期停止和格式限制。默认忽略 3 项真实服务测试及 2 项只读设备 / 进程实机测试。GUI 采集启停、非零电平、权限恢复和最低系统兼容性未测试。

本批使用独立 Mac 模块的 Core Audio IOProc，不经过 CPAL 的 input / 自动 loopback。私有 aggregate 仅包含指定进程 tap，不挂接物理输入，禁用等首个音频的 TapAutoStart；回调写入预分配的 48,000 帧 SPSC 环形缓冲，不做网络、文件、IPC 或阻塞锁。只将电平与计数发给 WebView，运行时检查目标 PID / bundle，异常不自动重连或扩大范围。正常清理顺序为停止 IOProc → 销毁 IOProc → 聚合设备 → tap；销毁失败时优先避免回调悬空指针，资源无残留仍须实机反复启停验证。

## 当前限制

- macOS 输出已使用稳定 Core Audio UID，由 `src-tauri/src/platform/macos.rs` 条件编译隔离；测试音与 TTS 共用精确设备解析。为使用 CPAL 公共 `DeviceTrait::id`，依赖更新为 CPAL 0.17.3 / Rodio 0.22.2，未引入私有字段访问或库补丁。其他平台暂保留名称路由。
- Mac 旧名称配置不会自动映射到 UID，需在常规设置重新选择试听 / 发送设备并保存；同名设备按不同 ID 独立显示，失效或歧义 ID 明确拒绝，无默认设备回落。配置结构仍兼容 v1，服务配置与凭据无需重新填写。
- 本批前端 37 项、Mac Rust 24 项默认测试、格式检查、严格 Clippy、生产构建及约 18.63 MiB 的 `.app` 构建通过。另显式运行只读 Mac 枚举检查，确认当前 4 个输出 ID 可重复枚举并解析到对应设备；不输出硬件 UID、不打开流。3 项真实服务测试及此实机枚举测试均默认忽略。未验证物理热插拔、真实播放、停止尾音或 Windows 运行，不据此宣称音频闭环完成。
- 已通过真实 DeepSeek V4.1 Flash 翻译和 MiniMax Speech 2.8 Turbo 合成 / 解码；第二家兼容翻译服务及真实播放仍未验证。详见[真实服务记录](validation/2026-10-23-live-providers.md)。
- Keychain、Core Audio taps、Mac WebView、全屏窗口行为均未实机验证。
- 设置页修改内容后需保存；离开设置页会放弃未保存配置，密钥操作是独立即时保存。
- 尚无可分发的签名 / 公证安装包。
