# 模型服务配置与兼容边界

[文档中心](README.md) · [设计与历史资料](archive/README.md) · [当前开发指南](development.md)

> 设计或阶段记录：保留写作当时的方案与验证范围，可能包含已被替代的实现。当前操作请看[使用指南](user-guide.md)，当前结构请看[架构总览](02-architecture.md)。

## 1. 目标

用户希望后续可灵活更换模型与服务。设计将服务凭据、API 地址、协议适配器、模型 ID 分开配置；应用逻辑只依赖 ASR / Translation / TTS 能力，不硬编码某一家供应商。

API Key 是凭据，不是兼容协议。不能通过是否以 `sk-` 开头判断可用性，也不限制供应商密钥前缀。能否只改配置切换，取决于认证、端点、请求字段、响应结构、流式事件和实际能力是否匹配。

## 2. 兼容矩阵

| 阶段 | 第一版接入方向 | 可以只改配置的条件 | 仍需新适配器的情况 |
| --- | --- | --- | --- |
| 翻译 | OpenAI-compatible Chat Completions | 请求与响应兼容，模型可接受文本对话，认证受支持 | 仅支持其他文本协议，或私有流式结构 |
| ASR | 供应商原生流式识别 | 同一协议、音频格式、事件和认证约定 | 新的 WebSocket 协议、签名方式或定稿机制 |
| TTS | MiniMax WebSocket / OpenAI-compatible Audio Speech（已实现本机模拟验证） | 同一协议下模型、音色与 MP3 格式受支持 | 不同音频分片、编码、认证或任务协议 |
| 其他音频兼容接口 | 后续按需求添加 | 经对应音频端点测试通过 | 不能由“文本接口兼容”推断 |

第一版翻译不同时实现所有文本协议；若服务仅提供 Responses 等其他协议，需要另行适配，不能把它当成 Chat Completions 使用。支持文件上传转录也不等于支持低延迟流式识别。

MiniMax 的文本接口提供 OpenAI SDK 兼容方式，而其 WebSocket TTS 有单独的任务事件与音频格式。这说明同一厂商的文本兼容能力不能外推到语音协议。[官方文本兼容说明](https://platform.minimax.io/docs/api-reference/text-openai-api)、[官方 TTS 协议](https://platform.minimax.io/docs/api-reference/speech-t2a-websocket)

## 3. 配置契约（拟议）

| 字段 | 用途 |
| --- | --- |
| profile_id / display_name | 稳定标识与用户可读名称 |
| stage | asr / translation / tts |
| adapter_type | openai_chat_completions / minimax_tts_ws / openai_audio_speech / 具体 ASR 适配器 |
| base_url | HTTP API 根地址，路径规则由适配器定义 |
| websocket_url | 原生流式协议使用的地址，与 HTTP 地址分开 |
| auth_type / credential_ref | 认证类型与安全存储引用；不在普通配置存密钥 |
| model_id | 模型名称，支持手动输入 |
| options | 此阶段支持的语言、音色、超时、采样率等受校验参数 |
| capabilities | 适配器声明与已测试能力，不靠模型名猜测 |
| validation_status | 未测试 / 可连接 / 对应功能测试通过，并记录时间 |

一个供应商可有多个不同用途的配置，同一密钥可显式关联多个阶段；不自动将某阶段密钥发送给另一地址。模型 ID 为非空字符串，不维护封闭的厂商枚举。参数按适配器白名单校验，不直接接受任意 JSON 覆盖认证头或 URL。

地址规则必须确定，避免重复拼接 `/v1`；各适配器文档明确要求填根地址还是完整端点。凭据仅发送到配置目标，不随跨域重定向转发。远程默认 HTTPS / WSS，本地开发服务可显式使用回环地址 HTTP / WS。

## 4. 能力与连接检查

能力至少包括：partial / final 识别、流式输出、语言集合、音频输入输出格式、取消方式、音色配置和模型列表支持。能力首先由适配器声明，再由实际功能测试确认；“检查连接成功”不等于低延迟或质量达标。

不要求服务必须提供模型枚举端点。模型列表为辅助功能，用户可手动输入模型 ID。测试文本翻译、测试识别和测试语音合成分别执行，不以一个聊天请求通过判定整套服务可用。

## 5. 切换与失败行为

- 设置保存不立即切换正在运行的音频流。
- ASR 配置变化在下一次监听启动生效；发送任务提交时取得配置快照，下一次任务使用新配置。
- 不自动回退到其他厂商，以免内容发送到用户未选择的服务或产生额外费用。
- 认证、余额、模型不存在、能力不支持、网络故障分别显示；不把它们统一报为“Key 格式错误”。
- 配置导出不包含密钥；导入后提示重新配置凭据。

## 6. 适配验收

翻译至少用两个独立 OpenAI-compatible 服务验证只改配置可切换；无第二组凭据时标为未验证。分别覆盖普通返回、流式返回（若启用）、无模型列表、认证失败、模型不存在与取消。ASR / TTS 的替换只有对应协议实现并验证后才标为支持。

最终对用户的承诺应是“可配置与可扩展”，而不是“任意 API Key 均可直接使用”。

## 7. 已实现的服务预设（2026-10-23）

设置 → 对应模型服务 → 新增配置，可选择 DeepSeek V4.1 Flash 或 MiniMax Speech 2.8。预设只包含公开地址、模型与音色，没有密钥；再次选择会复用原配置并保留用户编辑。

| 服务 | 地址 | 模型 / 参数 |
| --- | --- | --- |
| DeepSeek V4.1 Flash | `https://api.deepseek.com` | 模型 `deepseek-flash`；翻译预设 `thinking.type=disabled` |
| MiniMax 国内语音 | `wss://api.minimax.cn/ws/v1/t2a_v2` | `speech-2.8-turbo`；示例音色 `male-qn-qingse` |

DeepSeek 官方要求使用 `deepseek-flash` 调用当前 V4.1 Flash，预设不使用展示名作为模型 ID。[官方首次调用说明](https://api-docs.deepseek.com/zh-cn/)

思考模式可选“服务默认 / 关闭 / 开启”。服务默认时不携带 `thinking` 字段；关闭 / 开启时才发送供应商扩展。该字段不是通用兼容保证，不支持它的服务应保持“服务默认”。[DeepSeek 思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)

MiniMax 模型与音色可手动修改；`speech-2.8-hd` 是另一选择，本轮未调用验收。国内与国际地址由用户显式选择，不因认证失败自动更换区域。[MiniMax 语音协议](https://platform.minimax.cn/docs/api-reference/speech-t2a-websocket)
