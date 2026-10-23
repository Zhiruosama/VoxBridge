# 2026-10-23 千问实时识别

> 以下记录首批实时识别实现。后续已增加有界自动恢复和同时收发，见[新验证记录](2026-10-23-duplex-recovery.md)。

本轮增加 `qwen_dashscope_asr`，保留原 HTTP 短 WAV 适配器。实时预设使用用户提供的同一网关 `wss://maas.qianwenaiapi.com/api-ws/v1/inference` 和已真实验证的 `qwen-audio-3.0-asr-flash-streaming`。配置不保存密钥；本机授权联调后，为实时预设建立独立 Keychain 项 `provider-qwen-realtime`，沿用同一网关现有凭据，不改动其他服务。

协议依据：[实时识别指南](https://platform.qianwenai.com/docs/developer-guides/speech/asr-realtime)、[客户端事件](https://platform.qianwenai.com/docs/api-reference/speech-recognition/qwen-audio-asr-streaming/client-events)、[服务端事件](https://platform.qianwenai.com/docs/api-reference/speech-recognition/qwen-audio-asr-streaming/server-events)。实现 run-task → task-started → 二进制 PCM → finish-task，校验 task_id；不混用另一类 session.update 协议。

## 行为

- 服务就绪后才启动目标进程采集；下混、抗混叠重采样到 16 kHz mono PCM16，每约 20 ms 发送一块。
- PCM 队列最多约 2 秒；积压、采集丢帧、进程退出会中止，避免旧声音持续排队或不连续声音被误拼接。
- 同一句 partial 替换，revision 递增；重复 partial、已定稿的迟到更新及心跳不产生新字幕。当时只翻译 final，译文绑定相同 segmentId / revision；后续已加入[临时译文周期更新](2026-10-23-faster-realtime-translation.md)。
- 翻译独立串行队列最多 4 句，等待超过 20 秒跳过；不阻塞原文更新。跳过数在状态详情中查看。
- 建连 / 启动各 15 秒，写入最多 5 秒，响应等待最多 45 秒，finish 等待最多 10 秒。停止同时取消采集、网络及翻译，不重放旧音频。
- 新增“Qwen ASR · 实时”预设，字幕页统一“开始监听”；HTTP 文件验证入口在实时配置下禁用并提示回到字幕页。

## 验证

默认回归：前端 66 项、Rust 60 项通过，12 项硬件 / 付费 / 辅助测试默认忽略。严格 Clippy、格式检查、Mac `.app` 构建及 `codesign --verify --deep --strict` 通过。新版原生设置界面已检查实时预设、协议、独立凭据“已配置”、保存及返回字幕页；本机当前 ASR 已选用实时预设。新增协议测试覆盖 partial/final 修订、等待就绪后发送、finish 顺序、早期 / 活跃取消、任务标识不匹配及服务错误脱敏。

手动调用用户已授权的 Qwen / DeepSeek，仅发送程序生成的英文，不上传聊天或麦克风录音：

| 验证 | 结果 |
| --- | --- |
| 已生成英文 WAV 以实时节奏发送 | 5 次识别更新，最终文本含预期 meeting 句子 |
| 原生 Core Audio 采集受控播放进程，生产实时处理器 → 中文翻译 | 4 次 partial + final，译文与定稿 ID / revision 匹配，停止正常退出 |

原生测试从整个监听初始化起计：首次 partial 12,005 ms、final 14,990 ms、译文后停止 15,843 ms。这包含连接、采集初始化、等待静音回调、测试播放和服务处理，不能当作从说话开始计算的延迟，更不能推导 p95 或实际 Discord 性能。

```sh
cargo test --manifest-path src-tauri/Cargo.toml --locked live_qwen_realtime_generated_audio -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --locked live_realtime_capture_to_bilingual_subtitles -- --ignored --nocapture
```

第一条手动测试在验证成功后，仅当实时凭据项不存在时复制同网关凭据，不覆盖已有项。普通测试不读写真实凭据。

## 尚未验收

自动重连、睡眠唤醒、权限恢复、长时间运行、真实中文、Chrome 实际会话及 Discord 对端。自动重连尚未实现，错误会停止，需要手动重新开始。

用户已明确使用 Chrome 网页版 Discord。`system_profiler SPAudioDataType` 只列出物理输入 / 输出；磁盘上的 ParrotAudioPlugin 未暴露可用虚拟设备。未安装新驱动、未修改 Chrome / Discord 权限或加入任何通话。后续需要可用的虚拟设备：VoxBridge 发送到其输出，Chrome Discord 选择其输入；Discord 播放应走物理耳机，避免回环。Chrome 目标音频进程需实际发声后选择，不能承诺按标签页隔离。
