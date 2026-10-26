# 2026-10-23 真实服务验证

[验证索引](README.md) · [当前使用指南](../user-guide.md)

> 历史验证记录：仅说明记录日期的测试范围，不代表所有平台、客户端或后续构建均通过。

环境：Windows 开发机。用户授权使用其 DeepSeek / MiniMax 凭据进行少量真实请求。密钥通过私有标准输入传给手动测试进程，保存至应用的系统凭据存储；没有写入源码、普通配置、报告或请求日志。

## 配置与结果

| 服务 | 公开配置 | 结果 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/chat/completions`；`deepseek-flash`；thinking disabled | 中英双向翻译通过 |
| MiniMax 国内 | `wss://api.minimax.cn/ws/v1/t2a_v2`；`speech-2.8-turbo`；`male-qn-qingse` | WS 任务、音频合并、MP3 解码及非静音检查通过 |

DeepSeek 的正确模型标识来自[官方文档](https://api-docs.deepseek.com/zh-cn/)，关闭思考使用其[思考模式参数](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)。MiniMax 模型与任务参数依据[官方 WS 协议](https://platform.minimax.cn/docs/api-reference/speech-t2a-websocket)。HD 变体没有调用验收。

## 最终复测样例

1. 输入：`Please do not cancel the meeting. It starts at 10 tomorrow morning.`
   输出：`请不要取消会议。会议明天上午10点开始。`，671 ms。
2. 输入：`请把更新后的文档发给 Alex，预算是 250 美元。`
   输出：`Please send the updated document to Alex; the budget is 250 USD.`，482 ms。
3. 把第一条译文传入 MiniMax：合成并解码共 826 ms，68013 字节 MP3，32000 Hz、单声道，解码约 4.212 秒，样本非静音。FFprobe 独立确认格式、采样率与时长。

上述为少量样例的本机观测，不是平均 / P95 延迟，也不是首音延迟。当前完整接收再播放；未实际打开输出设备，未测扬声器听感或虚拟麦克风。

测试输出音频只保存在被 Git 忽略的 `src-tauri/target/live-validation/minimax-preview.mp3`，未提交录音内容。

## 发现并修复的问题

初次 MiniMax 合成已成功返回数据，但解码触发 Symphonia 0.5 的 gapless 算术溢出。真实流的 Xing 头帧数为 0，尚未最终填写；默认裁剪用总帧数减 padding / delay 时下溢。

修复：关闭 gapless 裁剪，按实际数据帧解码，继续执行时长、样本数量与格式上限。使用自行生成的 MP3 改写帧数头复现并覆盖回归，不把用户音频加入测试夹具。修复后真实复测通过。

## 自动检查与手动入口

- 前端 9 项测试；Rust 17 项默认测试通过，覆盖思考字段显式发送 / 默认省略、预设复用、错误码脱敏和零帧头解码。
- `live_provider_smoke` 是默认忽略的手动付费测试，调用生产网络和解码函数。显式运行时读取 JSON 标准输入；空输入则复用系统凭据，失败会导致测试失败。
- 凭据 ID：`provider-deepseek-flash`、`provider-minimax-cn`，与设置页预设一致。在本开发机选择预设后可看到已配置的密钥；其他电脑需另行保存。
- 取消前置检查通过：预先取消的 token 不建立合成任务。网络等待中的取消由本机模拟测试覆盖；真实播放中的停止尚未验收。

按需在已有系统凭据的开发机运行（可能产生服务费用，常规 CI 不运行）：

```sh
cargo test --manifest-path src-tauri/Cargo.toml live_provider_smoke -- --ignored --nocapture
```

如等待标准输入，直接回车使用系统凭据。不要把真实 Key 写进命令行、脚本文件或报告。

仍待验证：实际设备播放、音质听评、停止尾音、BlackHole / Discord、Mac Keychain、应用采集、ASR、长时间稳定性和第二家兼容翻译服务。

## 用户报错排查：MiniMax 区域不匹配

用户遇到“语音服务请求失败，请检查服务配置或稍后重试”。检查应用保存的非敏感配置后，当前活动项是早期 `tts-default`，地址仍为 `wss://api.minimax.io/ws/v1/t2a_v2`，模型与音色已填写正确。

用当前系统存储的同一把密钥进行明确的双地址握手检查（未提交合成文本）：

| 地址 | 实测结果 |
| --- | --- |
| `api.minimax.io` | HTTP 200，JSON `base_resp.status_code=2049`，WebSocket 未建立 |
| `api.minimax.cn` | HTTP 101，`connected_success`，状态码 0 |

再用当前 `tts-default` 密钥在国内地址提交一句短测试：745 ms 返回 35757 字节 MP3，可解码且非静音。说明当前凭据在国内站可用，区域不匹配是本次失败原因。[MiniMax 官方区域匹配说明](https://github.com/MiniMax-AI/MiniMax-MCP/blob/main/README-CN.md)

修复：新配置与占位示例默认国内地址；握手失败保留 HTTP 状态，对有限大小 JSON 提取数字错误码，显示认证 / 余额等分类和当前区域，不回显供应商原始文本。新增 HTTP 200 + 错误码 2049 的回归检查，避免再次显示不明确的通用失败。

已保存的自定义配置不自动跨区修改。当前用户需在“设置 → 语音合成”将地址改为 `wss://api.minimax.cn/ws/v1/t2a_v2` 后保存；模型、音色与密钥可保留。

排查后：前端 9 项测试、Rust 18 项自动测试通过；3 个真实服务手动测试默认忽略。本轮运行了区域握手与当前凭据的国内合成测试，未测试实际输出设备。
