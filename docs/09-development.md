# 当前开发指南

## 当前可用功能

- React / TypeScript 工作台：深色 / 浅色 / 跟随系统、字幕流、底部输入、设置与诊断。
- 固定样例演示：partial 到 final 的更新、双语成对展示、有界历史、暂停后晚到事件隔离。它不访问任何真实音源。
- ASR / 翻译 / TTS 分阶段保存多个 profile，手动填写地址、模型与音色。非敏感配置位于当前 WebView 的 localStorage，不包含密钥和字幕历史。
- Rust 后端通过系统凭据存储保存密钥：macOS Keychain / Windows Credential Store。已有密钥不会被读取回前端；Mac 行为尚未实测。
- OpenAI-compatible Chat Completions 文字翻译：本机后端调用、超时、响应大小限制、停止与取消、对常见错误分类。当前采用非流式完整译文，后续按需求扩展流式翻译。
- 输出设备诊断：用户选择设备后，显式播放约 1 秒的低音量测试音并可停止。不执行任何自动系统默认设备切换。
- TTS：MiniMax WebSocket 与 OpenAI-compatible `/audio/speech`；内存有界接收、解码后试听 / 指定设备发送、停止。两种协议通过本机模拟服务测试；真实供应商及实际声音待验证，详见 [TTS 开发说明](10-speech-backend.md)。
- 独立 Swift 原生采集探针，待 Mac 编译及权限 / 采集验证。

## 尚未实现

真实应用音频接入、ASR 服务与音频转换、TTS 边接收边播放、独立悬浮窗、稳定设备 UID、睡眠 / 断连恢复、用量估算、诊断导出、麦克风翻译。未接入能力的按钮明确禁用并提供原因；不放置伪造的监听状态。当前不等于 M1 音频闭环或 M2 端到端原型完成。

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

结果位于 `src-tauri/target/release/bundle/macos/` 和 `bundle/dmg/`。Mac 构建与发布签名尚未验证，不把配置存在等同于安装包已验收。

需要开发时单独检查界面，可使用 `npm run dev` 打开 `http://127.0.0.1:1420`；这不是产品交付形态。`npm run build` 只构建前端；`npm run desktop:build` 按当前平台生成应用 / 安装程序。只浏览界面无需 BlackHole；只有后续虚拟路由测试才需要安装。

主界面仅保留字幕与输入。演示和设备测试位于 **设置 → 音频与诊断**；无常驻“浏览器预览”“开发预览”等标识。真实监听仍禁用；桌面版可配置 TTS 后试听和发送语音。

设置工作区左侧按常规、文字翻译、语音识别、语音合成、音频与诊断分类。常规页提供主题、试听 / 发送设备、设备诊断入口和版本信息；模型页采用连接与凭据两个分组。普通配置统一点击“保存更改”，密钥仍独立保存。同一设置工作区切换分类保留草稿，离开工作区会放弃未保存内容。

Windows 已额外验证内嵌资源的独立开发程序：关闭开发服务器后仍可启动。当前本地输出为 `src-tauri/target/debug/voxbridge.exe`；这是用于验证的开发构建，不是正式安装包。发布构建继续使用上述桌面打包命令。

## 测试翻译

1. 在桌面版设置 → 文字翻译中填写服务根地址，例如 `https://服务地址/v1`，不含 `/chat/completions`。
2. 填写供应商真实支持的模型 ID，单独保存其 API Key，再保存设置。
3. 回到工作台，选择语言，输入短文本，点击“翻译”。此操作会将文本发送给配置的服务，可能计费。
4. 检查译文，测试停止和错误提示。没有 Key 时明确失败，不退回虚假译文。

兼容协议是 Chat Completions，不是任意“OpenAI 格式 Key”；没有模型列表的服务也可使用。每次任务使用当前配置快照，运行中的任务不因设置变化改变地址。

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
3. 执行 [Mac 探针说明](../native/macos/README.md) 的构建、进程枚举与采集步骤。
4. 用真实耳机测试输出，再明确选择 BlackHole 测试；确认聊天软件输入 / 输出路由。
5. 按 [Mac 验证矩阵](06-development-validation.md) 记录通过、失败和未测项。探针通过后再接入正式音频帧和服务流水线。

## 当前限制

- 输出诊断暂以设备名匹配，同名设备拒绝播放；不是正式稳定 UID 实现。
- 已通过本机模拟 HTTP 测试，但尚未通过真实供应商或第二家兼容服务验证。
- Keychain、Core Audio taps、Mac WebView、全屏窗口行为均未实机验证。
- 设置页修改内容后需保存；离开设置页会放弃未保存配置，密钥操作是独立即时保存。
- 尚无可分发的签名 / 公证安装包。
