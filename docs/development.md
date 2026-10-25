# VoxBridge 开发与打包

[返回首页](../README.md) · [使用指南](user-guide.md) · [架构设计](02-architecture.md)

本页介绍当前主分支。历史设计文档和联调记录可能描述已被替代的方案，例如 Keychain、密钥模板和旧音频路由；实际行为以当前代码、使用指南及对应版本说明为准。

## 环境

- macOS 14.2+，优先验证 Apple Silicon。
- Apple Command Line Tools、Node.js 22.12+（CI 使用 24）、Rust stable 1.96+。
- Windows 构建需要 C++ Build Tools 与 WebView2，当前应用声音采集和虚拟麦克风尚未接入。适配现状、实机开发步骤与验收要求见 [Windows 开发交接](windows-handoff.md)。

正式安装包已包含前端和原生程序，使用者无需安装这些开发工具。

## 本地启动

```sh
git clone https://github.com/Zhiruosama/VoxBridge.git
cd VoxBridge
npm ci

# macOS：生成驱动安装包资源，不安装驱动
bash native/macos/virtual-mic/build.sh

npm start
```

`npm start` / `npm run desktop` 启动 Tauri 开发应用，并自动启动 Vite。不要另外启动占用 1420 端口的服务。

`npm run dev` 只提供界面预览。原生音频、凭据和真实模型调用需要桌面版。

## 检查

```sh
npm run format:check
npm test
npm run build

# 干净检出后，macOS 必须先生成上文的驱动资源
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked -- --test-threads=1
```

真实服务、计费调用、录音和设备播放测试默认忽略，应在明确测试范围后单独执行。自动化通过不等于所有聊天软件或音质场景验收通过。

## 打包与发布

```sh
# 只构建 .app
npm run desktop:build -- --bundles app

# 构建 .app 与 .dmg
npm run desktop:build:mac
```

产物位于 `src-tauri/target/release/bundle/`。macOS 构建会先测试并打包虚拟麦克风驱动，再内嵌 `VoxBridgeAudio.pkg`。打包后脚本检查应用签名、麦克风 entitlement 和用途说明。

当前使用 ad-hoc 签名，尚未 Developer ID 签名或公证。临时签名的程序更新后，macOS 隐私授权可能需要重新确认。发布前还需要单独验证目标架构、安装权限和干净机器行为；不要将本机调试设备作为发行依赖。

GitHub Actions 的 [release.yml](../.github/workflows/release.yml) 在推送 `v*` 标签时构建 Apple Silicon DMG、生成 SHA-256 校验值并发布为 prerelease。标签必须与 `package.json` 和 Tauri 配置中的版本一致，并提供 `docs/releases/<标签>.md`。先完成测试、打包和附件上传，再公开 Release。

## 实现入口

先看[整体架构图](02-architecture.md#整体结构)与[内部流程图](internal-flows.md)，再按下表进入代码。内部流程文档覆盖分句与修订、发送队列、取消恢复、浮窗同步和资源上限。

| 部分                 | 入口                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| 界面与设置           | React + TypeScript，`src/`                                                            |
| 桌面后端与供应商请求 | Tauri 2 + Rust，`src-tauri/src/`                                                      |
| 应用声音采集         | macOS Core Audio process tap，`src-tauri/src/platform/macos_capture.rs`               |
| 设置页设备列表       | 只读 Core Audio 属性，`src-tauri/src/platform/macos/inventory.rs`；不初始化麦克风输入 |
| 发送队列             | `src/core/send-queue.ts`、`src-tauri/src/speech/prepared.rs`                          |
| 虚拟麦克风           | AudioServerPlugIn，`native/macos/virtual-mic/`                                        |

模型服务目前接入 Qwen 实时 WebSocket 与 HTTP 短音频 ASR、OpenAI 兼容 Chat Completions、MiniMax WebSocket 和 OpenAI 兼容 Speech。MiniMax 支持 PCM 流式播放，兼容 HTTP Speech 当前接收完成后播放。扩展服务需要遵循对应适配器协议，不能只增加下拉菜单选项。

## 配置与凭据

普通设置由前端保存，不包含 API Key 或字幕历史。凭据使用独立的本机私有目录，密钥与随机本机加密钥分文件保存；macOS / Linux 目录权限为 `0700`，文件权限为 `0600`。该方案依靠当前系统用户的文件权限，不隔离同一用户下有相应文件读取权限的其他程序。

现行凭据流程不依赖每次构建的签名，也不在正常保存、读取、重启时访问 Keychain。旧存储的一次性迁移、删除语义与验证见[密钥持久化记录](validation/2026-10-24-private-credentials.md)。开发密钥、用户配置、克隆样本和录音不能随安装包或源码发布。

## 进一步阅读

- [本机诊断日志、导出和字段说明](diagnostics.md)

- [服务配置与协议边界](08-provider-configuration.md)
- [实时字幕优化记录](12-streamvox-optimization-progress.md)
- [虚拟麦克风、安装和卸载](../native/macos/virtual-mic/README.md)
- [Discord 实测与音质边界](13-virtual-microphone-and-monitoring.md)
- [微信虚拟麦克风调查](wechat-virtual-microphone-investigation.md)
- [设计文档目录](README.md)（含早期方案）
