# 本机诊断日志

[使用指南](user-guide.md) · [内部流程](internal-flows.md) · [开发指南](development.md)

用于定位操作失败、重连、发送队列暂停和阶段耗时，不是云端统计服务。

## 出问题后怎么提供日志

1. 保留报错截图，并记下大致发生时间与操作步骤。
2. 打开「设置 → 音频与诊断 → 本机诊断日志」，点击「导出日志」。
3. 程序生成 `VoxBridge-diagnostics.jsonl` 并打开所在文件夹。可自行查看后，随问题反馈发送此文件。
4. 一并提供应用版本、操作系统版本、CPU 架构及是否使用虚拟麦克风。不要发送 API Key 或整个应用数据目录。

导出只读取本功能的三份运行日志，不包含服务配置、凭据目录、录音或历史聊天。导出文件保存在日志目录的 `export/` 下，每次导出替换上一次文件；若需要保留多个快照，先将上一份复制到其他位置。

「打开日志文件夹」显示原始轮转文件。macOS 默认位置为：

```text
~/Library/Logs/com.voxbridge.desktop/diagnostics/
  diagnostics.jsonl
  diagnostics.1.jsonl
  diagnostics.2.jsonl
  export/VoxBridge-diagnostics.jsonl
```

实际根目录由 Tauri 的 `app_log_dir` 解析。导出与打开文件夹都仅允许主窗口执行；浮窗只能追加经过白名单校验的元数据，不能读取日志。

## 记录什么

| 场景                                     | 记录内容                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| 启动、正常退出、Rust panic               | 应用版本、系统平台、架构、运行标识和事件类型；panic 不记录消息或调用栈         |
| 翻译、ASR、录音、TTS、设备查询与配置操作 | 命令开始、结束、耗时、随机请求标识、固定协议类型、失败分类                     |
| 监听恢复                                 | 监听会话标识、恢复代次、退避时间、设备或网络类别                               |
| 实时字幕                                 | 定稿数量、翻译成功/失败数量、排队数、在途数、P95 耗时；每类汇总最多每 5 秒一条 |
| 语音输出                                 | 合成、解码、等待设备、开始播放、完成等阶段，以及相对本次操作的耗时             |
| 发送队列                                 | 状态变化、数量、暂停/继续、取消和完成；重复状态不反复记录                      |
| 界面与本地配置                           | 页面进入、主题切换、配置保存与读取失败；不保存配置值                           |
| 前端未处理错误                           | 事件类别与错误分类，不记录错误原文、文件路径或堆栈                             |

监听详情还提供下混后的单声道电平、接近满幅帧数、下混电平明显低于原始声道的窗口数，以及近期字幕纠正数和供应商句末分歧数。接近满幅不等于已削顶，下混低电平也只是排查线索，不会据此自动改声道或增益。

日志中的 `recognition_corrections` 用 `count` 表示本连接被纠正的字幕数、`failedCount` 表示发生近期字幕分歧的供应商句末数；`audio_quality` 用相同字段分别表示接近满幅帧数和下混低电平窗口数。这里的 `failedCount` 是分类计数，不表示请求失败。最多每五秒采样一次，不记录原文或波形。

不会记录音频数据、字幕、输入草稿、译文、API Key、认证头、供应商原始响应、服务地址、用户预设名或设备名称。正常业务请求仍按用户选择发送到模型服务，但诊断日志没有新增上传流程。

配置保存日志只说明命令是否完成，不保存配置对象；随机请求标识也不使用用户输入、模型名或设备 UID。

<details>
<summary>开发者参考：日志字段、资源限制与实现</summary>

## 如何阅读

文件使用 JSON Lines 格式，每行一个 JSON 对象。下面是示意数据：

```json
{"schemaVersion":1,"timeUnixMs":1792915200000,"uptimeMs":1240,"runId":"example-run","version":"<应用版本>","platform":"macos","architecture":"aarch64","source":"main","operation":"translate","kind":"start","traceId":"11111111-2222-4333-8444-555555555555","correlationId":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee:0"}
{"schemaVersion":1,"timeUnixMs":1792915200600,"uptimeMs":1840,"runId":"example-run","version":"<应用版本>","platform":"macos","architecture":"aarch64","source":"main","operation":"translate","kind":"error","traceId":"11111111-2222-4333-8444-555555555555","correlationId":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee:0","durationMs":600,"reason":"invalid_response"}
```

- `runId` 区分应用进程的本次运行；不是账号或设备标识。
- `timeUnixMs` 是墙上时钟毫秒，方便对照截图时间；`uptimeMs` 是本次启动后的单调时间。
- `adapter` 仅记录固定协议代码，例如 `minimax_tts_ws`，不记录供应商地址、模型或音色名称。
- `attempt` 表示相应监听事件的恢复代次。
- `traceId` 关联一次前端到后端命令的开始与结束。
- `correlationId` 关联监听会话或发送任务；冒号后的数字区分发送任务重试代次。
- `durationMs` 在命令结束时表示该命令总耗时；在语音阶段事件中表示距离请求开始的时间；在汇总事件中表示相应流程的 P95 耗时。P95 是最近样本的统计，不等于单次请求耗时。
- `reason` 是固定分类，例如 `auth`、`quota`、`timeout`、`network`、`device`、`invalid_response`。`unknown` 表示未能分类，不能据此断定具体故障原因。

排查时先按 `runId` 和发生时间定位，再用 `traceId` 或 `correlationId` 串起阶段。只有 `start` 没有对应结束时，要结合退出、panic、重连事件和截图判断，不能直接当作供应商故障。

## 资源和隐私边界

- 使用独立写入线程和容量为 512 的有界通道。写入端繁忙时丢弃诊断事件，不阻塞音频采集回调或业务请求。
- 单份日志上限 1 MiB，保留当前文件与两份历史文件；原始日志总量约 3 MiB。导出快照另占最多约 3 MiB，仅保留一份固定文件。
- 导出在写入线程中顺序处理，避免一边轮转一边复制造成快照混乱。
- macOS / Linux 日志目录权限为 `0700`，文件权限为 `0600`。日志未额外加密；同一系统用户下有相应权限的程序仍可能读取。
- 导出头部的 `droppedEvents` 是本次运行中排队或写入失败的事件数量。磁盘故障、强制结束进程或队列溢出时，记录可能不完整；日志故障不应阻止正常使用。
- 元数据也包含操作时间、软件版本和使用阶段。分享前仍可自行检查，删除原始日志后无法恢复相应历史。

## 实现和验证

- [`src/diagnostics.ts`](../src/diagnostics.ts)：命令生命周期、异常分类、语音阶段和监听汇总。
- [`src/core/diagnostics.ts`](../src/core/diagnostics.ts)：只返回固定错误类别与随机标识校验。
- [`src-tauri/src/diagnostics.rs`](../src-tauri/src/diagnostics.rs)：字段白名单、来源限制、有界通道与日志命令。
- [`writer.rs`](../src-tauri/src/diagnostics/writer.rs)：权限、轮转、顺序导出。
- [`前端测试`](../src/diagnostics.test.ts)、[`原生测试`](../src-tauri/src/diagnostics/tests.rs)：内容过滤、原始错误不落盘、日志失效不影响请求、轮转上限、导出范围与文件权限。

Rust panic 时会尝试在最多 800 ms 内刷新已入队的诊断元数据（日志写线程自身异常时不等待自身），以减少原生回调随后 abort 导致事件丢失的情况。这不保证记录所有系统级崩溃，也不记录 panic 消息或调用栈。

</details>
