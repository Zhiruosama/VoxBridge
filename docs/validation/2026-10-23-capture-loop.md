# 2026-10-23 Mac 受控音频闭环

[验证索引](README.md) · [当前使用指南](../user-guide.md)

> 历史验证记录：仅说明记录日期的测试范围，不代表所有平台、客户端或后续构建均通过。

环境：Apple Silicon、macOS 26.4。用户授权继续开发、使用工作区测试密钥做少量联调，并在检查通过后提交。三份本地凭据与对应 Keychain profile 一致；比较过程仅输出一致性结论，不打印密钥。没有上传用户会话、麦克风或其他应用的音频。

## 零样本复现与测试修正

旧测试先启动 `afplay` 播放 8.09 秒短片，再枚举进程、初始化 tap 和读取缓冲。本轮复现 482,304 帧、peak=0；延长同一合成样例后收到非零音频，peak=0.19538，并通过真实 ASR / 翻译。旧测试未等待采集就绪，无法排除启动时序错过音源，也不足以判断权限被拒绝。

改为独立的受控播放子进程：先打开输出流并保持静音，父进程选择其精确 PID / bundle，等待正式采集队列返回静音帧后，再通过 stdin 触发合成语音播放。子进程有超时上限和父进程析构清理，失败不遗留播放进程。没有更改系统隐私设置、扩大全局采集或更改 tap 的启动策略。

生产链路复测采用现有 `capture_segments`、PCM 转换 / 分段和四段有界队列，再调用现有 `SegmentProcessor`：

| 项目 | 结果 |
| --- | --- |
| 正式采集就绪 | 一次观测 70 ms，不包含播放子进程输出设备初始化，不是冷启动或 p95 |
| 采集进度 | 最新进度上报 125,440 帧，无丢帧，产出有声 WAV 段；该数值不是最终总帧数 |
| Qwen ASR | `qwen3-asr-flash`：`The meeting starts at ten tomorrow morning.` |
| DeepSeek 翻译 | `deepseek-flash`：`会议明天上午十点开始。` |
| 字幕事件 | 原文和译文 segment ID 一致；检查会议与时间内容，接受合理中文改写 |

这是受控英文合成音源经过真实系统音频捕获及真实服务的验证，不是向 ASR 直接提交原始样例文件。最终还检查两类事件和语义内容，避免仅以“请求返回成功”当作通过。

## 20 次采集启停与隔离

显式硬件测试创建两个受控音频子进程，每轮重新触发对照进程的 997 Hz 低音量测试音。独立 tap 确认对照音源确实有声音；目标进程静音时其 tap 不混入对照音源，目标发声后峰值 >0.01，停止发声后恢复静音。每轮销毁目标采集后清空缓冲，等待后确认无新帧。

20 轮通过。此检查证明受控进程隔离、音频开关和 IOProc 停止行为；没有统计系统全部残留对象，也没有验证权限撤回、设备热插拔或睡眠唤醒。

## 界面与打包修改

- 监听进度增加累计帧数，主窗口和采集诊断共用信号监测逻辑。
- 区分“音频帧未更新”和“持续收到静音帧”；静音不能证明权限失败。
- 初始化不计入等待时长；听到语音后的正常停顿不反复提示权限检查。停止、重启时使用全新监测状态。
- 原 `.app` 仅包含链接器生成的可执行文件签名，`codesign --verify --deep --strict` 报资源封印缺失。Tauri macOS 配置显式指定 `signingIdentity: "-"`，构建本地 ad-hoc 签名包；这不是 Developer ID 签名或公证。依据 [Tauri 签名说明](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing)。

## 打包应用 GUI 复测

修复签名后重启 `.app`，Qwen 设置显示 Keychain 密钥“已配置”，主窗口可正常调用真实 ASR 和翻译。曾在旧进程中观察到凭据状态读取失败；重新启动最新签名应用后恢复，没有重写或放宽凭据访问规则。

在工作台选定受控测试进程，英语 → 简体中文，点击开始分段监听；等界面提示“采集已就绪”后，通过测试进程 stdin 触发一次合成语音。主窗显示上述完整英文及中文译文，进度曾显示 1,912,320 帧、丢帧 0、跳过段 0、音频断点 0；正常语音停顿后保持监听进度，没有权限警告。

打开悬浮字幕窗，可见相同原文和译文。测试播放进程达到 120 秒保护上限后退出，主窗口报告目标音频进程已退出并停止，浮窗显示“监听已停止”，保留已有字幕。最后恢复原来的中文 → 英语偏好、刷新失效的测试进程并隐藏浮窗，未留下监听任务。没有验证浮窗按钮主动停止、全屏或多屏。

## 复现

默认检查不播放音频、不采集、不调用付费接口：

```sh
npm test
npm run build
npm run format:check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

本批前端 65 项、Rust 50 项默认测试通过；9 项手动 / 辅助测试保持忽略。下面两个手动测试需要明确授权，会打开真实输出设备、采集所建测试进程；第二个还会向已配置的 Qwen 网关和 DeepSeek 上传合成样例并计费。不要笼统执行所有 `--ignored` 测试，内部播放子进程仅供父测试启动。

```sh
# 仅受控测试音，无网络或凭据
cargo test --manifest-path src-tauri/Cargo.toml --locked live_capture_isolates_process_and_restarts -- --ignored --nocapture

# 生成公开英文测试句；不使用用户录音
mkdir -p native/macos/.build
/usr/bin/say -v Samantha -o native/macos/.build/capture-sample.wav --data-format=LEI16@16000 'The meeting starts at ten tomorrow morning.'

# 需要 provider-qwen-asr 和 provider-deepseek-flash 的 Keychain 凭据
cargo test --manifest-path src-tauri/Cargo.toml --locked live_synthetic_process_to_bilingual_subtitle -- --ignored --nocapture

# 本地开发应用包及资源封印检查
npm run desktop:build -- --bundles app
codesign --verify --deep --strict src-tauri/target/release/bundle/macos/VoxBridge.app
```

生成的音频和构建产物都在 Git 忽略目录中。正式分发需通过额外配置覆盖 `bundle.macOS.signingIdentity` 为自己的证书身份，补齐发布签名、公证和安装验收。

尚待验收：真实 Discord / 浏览器声音及其子进程选择、GUI 权限拒绝 / 恢复、中英双向长句与准确率、窗口与多显示器、TTS 实际设备输出及停止、BlackHole 路由、30 分钟稳定性。实时 WebSocket ASR 和增量 TTS 仍未接入。
