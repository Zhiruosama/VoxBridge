# 内部流程与状态

[架构总览](02-architecture.md) · [开发与打包](development.md) · [使用指南](user-guide.md)

本文说明当前实现的状态与边界。图中的节点是处理步骤，不一定各自对应一个进程或线程。数值来自当前代码，是资源限制或策略参数，不是对所有模型和网络环境的延迟保证。

## 1. 监听应用声音，生成字幕

```mermaid
flowchart TD
  Start[主窗口开始监听] --> Request[固定本次来源 / ASR / 翻译配置与语言]
  Request --> Tap[Core Audio process tap / WASAPI]
  Tap --> PCM[声道处理 / 重采样 / PCM 帧]
  PCM --> Adapter{ASR 协议}
  Adapter -->|实时 WebSocket| Partial[识别假设与供应商定稿]
  Adapter -->|HTTP 短音频| Chunk[分段音频识别]
  Partial --> Commit[稳定性与句子边界处理]
  Chunk --> Commit
  Commit --> Source[带标识和修订号的原文字幕]
  Commit --> Queue[有界翻译调度]
  Queue --> Translate[短上下文翻译与结果校验]
  Source --> UI[主窗口字幕状态]
  Translate -->|匹配的修订| UI
  UI --> Overlay[发布悬浮字幕快照]
```

### 为什么不直接用 ASR 的每次返回当一条字幕

实时 ASR 的 partial 会反复修正，也可能在一次供应商定稿里返回多个句子。因此字幕提交层要处理稳定文本、句子边界与剩余片段，而不是每隔固定时间切一段，也不是始终等待一整段长发言结束。

主要代码：

- [`asr/realtime.rs`](../src-tauri/src/asr/realtime.rs)：实时协议消息与识别结果。
- [`capture/listening/realtime/chunks.rs`](../src-tauri/src/capture/listening/realtime/chunks.rs)：字幕片段提交逻辑。
- [`capture/listening/realtime.rs`](../src-tauri/src/capture/listening/realtime.rs)：采集、识别事件和提交层的连接。
- [`translations.rs`](../src-tauri/src/capture/listening/realtime/translations.rs)：有界翻译调度与耗时指标。

识别阶段可以先显示原文，译文稍后更新同一条字幕。`sessionId` 区分监听会话，`segmentId` 标识字幕，`revision` 区分修订；前端 [`session.ts`](../src/core/session.ts) 校验事件是否仍属于当前字幕版本。不能仅凭“哪个请求最后返回”决定覆盖哪条译文。

翻译适配器接收目标语言、当前文本与短上下文，并检查响应内容。网络失败、空内容或无效结果会成为可处理的错误；不把模型生成的解释当成可靠译文。具体校验不是语义正确性的保证，识别错误和翻译质量仍受供应商影响。

### 停止和恢复

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Starting: 用户开始
  Starting --> Listening: 采集与服务启动
  Starting --> Recovering: 可恢复错误
  Listening --> Recovering: 网络或采集中断
  Recovering --> Starting: 退避后重试并提升 generation
  Recovering --> Error: 不可恢复错误或预算耗尽
  Starting --> Error: 配置或授权失败
  Listening --> Draining: 用户停止
  Recovering --> Draining: 用户停止
  Draining --> Idle: 尾句与译文收尾或超时清理
  Error --> Idle: 用户结束或重新操作
```

这是便于阅读的生命周期图，不是某一个枚举类型的完整清单。

- [`recovery.rs`](../src-tauri/src/recovery.rs) 只重试明确识别的临时错误，连续失败退避为 1、2、4、8、15、15 秒。一次运行稳定满 60 秒后可补充重试预算；配置和授权类错误不无限重试。
- 每次恢复提升 `generation`，前端 [`ListeningEpoch`](../src/core/listening.ts) 拒绝上一代事件。音频来源按应用身份重新解析，不能把已复用的 PID 当成原应用。
- 用户正常停止时尝试收尾，不立即丢弃尚未提交的尾句；当前收尾期限为 8 秒。收尾期间仅接收当前代次的定稿与翻译事件，超时后清理并保留已完成字幕。
- 入站监听与出站发送分别控制。停止监听不等同于取消所有正在发送的语音。

## 2. 主动输入与录音

用户可以直接打字，也可以在主窗口或浮窗开始录音。录音由 [`microphone.rs`](../src-tauri/src/microphone.rs) 管理，采集、识别与进度留在本机后端，单次上限 60 秒。

```mermaid
flowchart TD
  Text[文字输入] --> Draft[可编辑草稿]
  Mic[用户开始录音] --> Record[麦克风采集与 ASR]
  Record --> Mode{录音后直接发送}
  Mode -->|关闭| Draft
  Mode -->|开启| Send[发送队列]
  Draft -->|用户确认发送| Send
  Send --> Detect[检测实际输入语言]
  Detect --> Translate{需要翻译且与目标语言不同}
  Translate -->|是| Model[文字翻译服务]
  Translate -->|否| Original[使用原文]
  Model --> TTS[按目标语言合成语音]
  Original --> TTS
```

[`ComposerController`](../src/core/composer.ts) 实现语言检测、可选翻译与合成步骤：输出译文时，如果检测到输入已经是目标语言，则跳过翻译直接使用原文；检测结果未知时继续走所配置的翻译方向。选择输出原文也会跳过翻译。

语音消息和“语音转文字后确认”共用录音能力，差别在识别结果的去向。仅点击“翻译”的文本操作由 ComposerController 执行，不需要等待音频播放队列。

## 3. 发送队列：准备可并行，播放保持顺序

[`SendQueue`](../src/core/send-queue.ts) 在前端持有用户任务，后端持有预取音频和实际播放资源。

```mermaid
sequenceDiagram
  participant User as 用户
  participant Queue as SendQueue
  participant Compose as ComposerController
  participant Rust as Rust 合成与预取
  participant Output as 音频输出
  User->>Queue: 提交 A，复制本次配置
  Queue->>Compose: 检测与翻译 A
  Compose->>Rust: speak A
  Rust->>Output: A 流式合成并播放
  User->>Queue: 提交 B，复制本次配置
  Queue->>Compose: 检测与翻译 B
  Compose->>Rust: prepare_speech B
  Rust-->>Queue: B 音频准备完成，仅存内存
  Note over Queue,Output: B 即使先准备好，也等待 A 结束
  Output-->>Queue: A 播放结束
  Queue->>Rust: play_prepared_speech B
  Rust->>Output: 串行播放 B
```

- 最多保留 10 个待发送任务，同时最多运行 2 个处理任务。这里的“处理任务”包含等待和播放，不能理解为始终同时发送两个 TTS 网络请求。
- 队首优先直接合成播放，降低首次等待；后续任务可以提前翻译并调用 `prepare_speech`，但预取不打开输出设备。
- 每条任务使用入队时的设置快照。修改模型、音色或目标语言主要影响后续新任务，已提交任务不会被正在编辑的设置悄悄改变。
- 播放须轮到队首且没有其他播放任务。Rust 的 `AudioGate` 信号量进一步约束音频输出，防止重叠发声。
- 出错任务保留在队列，队列暂停；用户可以编辑、重试或取消。存在失败项时，不直接“继续”越过它。
- 任务取消或重试会改变代次，并清理预取结果、停止对应播放。迟到的请求完成回调不能重新播放已取消的任务。
- 接受发送后可以继续编辑下一条草稿；字幕区与队列承担结果展示，输入框不承担历史记录。

### TTS 与音频路由

MiniMax WebSocket 支持 32 kHz 单声道 PCM 流式接收与播放；兼容 HTTP Speech 的实现接收完整音频后解码播放。两者的首包行为不同，不能把“兼容接口”视为都支持流式输出。

发送路由输出到所选虚拟设备；试听路由输出到耳机或扬声器。发送时试听是单独的监听分支，不需要把系统默认麦克风改成 VoxBridge。虚拟驱动只完成音频环回，Discord 的降噪、回声消除和输入处理仍可能改变最终音质。

## 4. 悬浮窗与主窗口如何协作

浮窗是独立 WebView，不自行创建第二套监听或发送队列。主窗口协调业务，Rust 保存可读取的最新快照并转发窗口事件。

```mermaid
sequenceDiagram
  participant Main as 主窗口
  participant Host as Rust 窗口状态
  participant Float as 悬浮窗
  Main->>Host: publish_overlay / publish_overlay_voice
  Host-->>Float: 广播字幕与录音发送状态
  Float->>Host: 打开时 read_overlay / read_overlay_voice
  Host-->>Float: 最新快照
  Float->>Host: overlay_voice_action，携带用户操作
  Host-->>Main: 转发录音、发送、队列或语速动作
  Main->>Main: 操作共用业务状态
  Main->>Host: 发布新的版本快照
  Host-->>Float: 更新显示
```

字幕快照包含版本、会话、展示配置和字幕行；录音/发送快照包含阶段、电平、草稿、语速和队列等信息。后端校验大小与字段边界，前端按版本接收更新，避免旧广播覆盖新状态。API Key 不随快照传播。

主窗口和浮窗共享界面语言、字幕配色与任务进度。跨全屏空间显示由 macOS 窗口层适配；这与字幕数据同步是两个独立问题。

代码入口：[`core/overlay.ts`](../src/core/overlay.ts)、[`core/overlay-voice.ts`](../src/core/overlay-voice.ts)、[`SubtitleOverlay.tsx`](../src/components/SubtitleOverlay.tsx)、[`overlay.rs`](../src-tauri/src/overlay.rs)、[`overlay/voice.rs`](../src-tauri/src/overlay/voice.rs)、[`overlay/panel.rs`](../src-tauri/src/overlay/panel.rs)。

## 5. 标识与晚到事件

| 标识                      | 解决的问题                                         |
| ------------------------- | -------------------------------------------------- |
| `sessionId`               | 识别和翻译结果属于哪一次监听，防止旧会话串入新会话 |
| `segmentId` 与 `revision` | 返回的是哪条字幕的哪个版本，防止旧译文覆盖新修订   |
| 监听 `generation`         | 自动重连前后的事件分代，丢弃旧连接的消息           |
| 发送任务 ID 与代次        | 将取消、预取和播放绑定到同一条任务的本次尝试       |
| 快照 `version`            | 主窗口与浮窗按新旧接收状态，防止旧广播回滚显示     |

这些标识作用于不同层，不应互相替代。比如“窗口收到最新广播”并不能说明某条翻译就是当前字幕的最新修订。

## 6. 资源上限与验证入口

| 对象                | 当前限制或行为                                                      | 代码入口                                  |
| ------------------- | ------------------------------------------------------------------- | ----------------------------------------- |
| 字幕历史            | 最多 500 条，内存保留                                               | `src/core/session.ts`                     |
| 实时 ASR 待发送音频 | 有界通道，100 个 640 字节 PCM 块，约 2 秒 16 kHz 单声道 16-bit 音频 | `capture/listening/realtime.rs`           |
| 实时字幕翻译        | 定稿通道容量 32，同时最多 3 个翻译任务                              | `realtime.rs`、`realtime/translations.rs` |
| 主动录音            | 单次最多 60 秒                                                      | `microphone.rs`                           |
| 语音发送队列        | 最多 10 条、最多 2 个处理任务                                       | `src/core/send-queue.ts`                  |
| TTS 音频            | 单次音频响应受 8 MiB 等协议路径限制，预取留在内存                   | `speech.rs`、`speech/prepared.rs`         |
| 正常停止监听        | 尝试收尾，8 秒期限                                                  | `capture/listening/recovery.rs`           |

这些队列满时应触发丢弃、失败或恢复路径，不能无限堆积。不同阶段的上限是分开实现的，不能简单相加当作总内存上限或总延迟。

前端回归重点在 [`send-queue.test.ts`](../src/core/send-queue.test.ts)、[`session.test.ts`](../src/core/session.test.ts)、[`listening.test.ts`](../src/core/listening.test.ts)、[`overlay.test.ts`](../src/core/overlay.test.ts) 与 [`settings.test.ts`](../src/core/settings.test.ts)。原生侧在对应模块中覆盖取消、协议、缓冲、恢复与凭据持久化。

真实录音、供应商计费调用、聊天软件枚举和最终音质仍需要单独实机验证；单元测试通过不代表这些场景已经全部验收。执行命令见[开发指南](development.md#检查)。

## 独立文本翻译与恢复

```mermaid
flowchart TD
  Edit[编辑原文与语言] --> Submit[Enter 提交配置与文字快照]
  Submit --> Pending[等待翻译 / 继续编辑下一段]
  Pending -->|成功且标识匹配| Result[更新译文，不覆盖新草稿]
  Pending -->|取消| Cancel[本地解锁并取消后台请求]
  Pending -->|失败或截止| Failed[保留内容与失败快照]
  Failed --> Retry[手动重试，使用当前服务配置]
  Retry --> Pending
  Cancel --> Late[忽略迟到结果]
```

文字翻译截止与服务测试截止均不依赖后台确认才能恢复操作。超时和失败不自动重试，避免重复计费。错误分类提供处理建议，原始错误仅按需展开；草稿和结果不写入日志或持久化历史。
