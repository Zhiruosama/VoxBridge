# 2026-10-23 MiniMax 流式输出

[验证索引](README.md) · [当前使用指南](../user-guide.md)

> 历史验证记录：仅说明记录日期的测试范围，不代表所有平台、客户端或后续构建均通过。

本轮实现 MiniMax WebSocket → PCM16（32 kHz mono）→ 指定设备增量播放。OpenAI 兼容 HTTP / MP3 路径继续完整接收后解码，不自动切换接口或服务区域。任务协议参考 [MiniMax 官方 WebSocket 文档](https://platform.minimax.io/docs/api-reference/speech-t2a-websocket)。PCM 格式已使用本机凭据真实验证。

每个网络块最多 6,400 字节（100 ms），接收队列最多 8 块，播放器最多排队 3 块；网络消息上限 512 KiB、整体 8 MiB / 120 秒。分块边界允许落在单个 PCM16 样本中间；持续背压由有界队列传回 WebSocket。停止取消接收任务，丢弃排队内容并释放输出设备。设备失败会取消在途合成，最终保留真实设备错误。

自动回归覆盖 PCM 字节顺序与任意切块、空 / 截断 / 超长样本、元数据不匹配、final 到达前已交付音频、队列满时取消和上游错误脱敏。默认 Rust 55 项通过、10 项手动 / 辅助测试忽略；前端 65 项、严格 Clippy、格式与 Mac `.app` 构建及签名检查通过。

## 真实测试

用户授权的 MiniMax 国内凭据仅从 Keychain 读取。使用两句自行编写的短测试文本，没有上传用户聊天或录音，也没有连接 Discord 通话。

输出为当前 Mac 默认物理设备“外置耳机”，测试先取得其稳定 ID，再按生产路径精确解析，生产逻辑未增加默认回落。

| 场景 | 本机观察 |
| --- | --- |
| 完整播放“你好，这是流式语音播放测试。” | 首次 `playing` 进度 5,336 ms，整体 8,903 ms；状态 synthesizing → playing → completed |
| 播放中取消 | 首次 `playing` 4,318 ms，250 ms 后发出取消，整体 4,628 ms；最终 stopped |

`playing` 为后端将首块加入真实输出设备队列的时刻，包含输出初始化 / 网络等等待，不是声学首音时间。两次结果不能用来计算平均 / p95，不能与旧请求耗时直接比较得出加速结论。本轮验证了生产设备流的打开、队列消耗和取消返回；未验收主观听感、系统缓冲尾音或虚拟麦克风。

手动测试会实际播放音频并调用两次付费合成，只在明确授权后运行：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --locked live_minimax_streaming_physical_output_and_stop -- --ignored --nocapture
```

用户目标已明确为 Chrome 中的 Discord 网页版。当前没有 BlackHole / Discord 桌面版；系统存在 ParrotAudioPlugin，尚未证明其提供适用的可选输入 / 输出设备，不自动安装或重配驱动。Discord 对端验收仍待完成。
