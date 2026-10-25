# VoxBridge 开发与打包

[返回首页](../README.md) · [使用指南](user-guide.md) · [架构设计](02-architecture.md)

本页介绍当前开发代码；Windows 实现位于 `codex/windows-support`，尚未合并发布。历史设计文档和联调记录可能描述已被替代的方案，例如 Keychain、密钥模板和旧音频路由；实际行为以当前代码、使用指南及对应版本说明为准。

## 环境

- macOS 14.2+，优先验证 Apple Silicon。
- Apple Command Line Tools、Node.js 22.12+（CI 使用 24）、Rust stable 1.96+。
- Windows 构建需要 C++ Build Tools 与 WebView2。Windows 11 x64 已接入 WASAPI 应用进程树采集、共用监听业务和 NSIS 打包；虚拟麦克风使用随包的官方签名基础版 VB-CABLE，已验证本机音频回环；自有 VoxBridge Windows 驱动不属于首版实现。当前验证与限制见 [Windows 实机记录](validation/2026-10-25-windows-native.md)，后续见 [开发待办](windows-development-todo.md)。

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

Windows 开发启动前先运行 `node scripts/build-desktop-resources.mjs`，获取并校验随包的 VB-CABLE 原始资源，再运行 `npm start`；也适用于干净检出后的原生测试。Windows 安装包使用 `npm run desktop:build:windows`。首次构建需要网络。详见 [Windows 安装与更新](windows-installation.md)。

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

GitHub Actions 的 [release.yml](../.github/workflows/release.yml) 在推送 `v*` 标签时构建 Apple Silicon DMG 和 Windows x64 NSIS，生成更新签名与分平台 SHA-256 校验清单，两个平台都成功后统一发布 prerelease 并推进更新源；手动运行只构建验证，不发布。标签必须与 `package.json` 和 Tauri 配置中的版本一致，并提供 `docs/releases/<标签>.md`。先完成测试、打包和附件上传，再公开 Release。

## 实现入口

先看[整体架构图](02-architecture.md#整体结构)与[内部流程图](internal-flows.md)，再按下表进入代码。内部流程文档覆盖分句与修订、发送队列、取消恢复、浮窗同步和资源上限。

| 部分                 | 入口                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| 界面与设置           | React + TypeScript，`src/`                                                            |
| 桌面后端与供应商请求 | Tauri 2 + Rust，`src-tauri/src/`                                                      |
| 应用声音采集         | macOS Core Audio process tap / Windows WASAPI Application Loopback；`src-tauri/src/platform/capture.rs`               |
| 设置页设备列表       | 只读 Core Audio 属性，`src-tauri/src/platform/macos/inventory.rs`；不初始化麦克风输入 |
| 发送队列             | `src/core/send-queue.ts`、`src-tauri/src/speech/prepared.rs`                          |
| 虚拟麦克风           | macOS AudioServerPlugIn，`native/macos/virtual-mic/`；Windows VB-CABLE，`native/windows/`                                        |

模型服务目前接入 Qwen 实时 WebSocket 与 HTTP 短音频 ASR、OpenAI 兼容 Chat Completions、MiniMax WebSocket 和 OpenAI 兼容 Speech。MiniMax 支持 PCM 流式播放，兼容 HTTP Speech 当前接收完成后播放。扩展服务需要遵循对应适配器协议，不能只增加下拉菜单选项。

## 配置与凭据

普通设置由前端保存，不包含 API Key 或字幕历史。凭据使用独立的本机私有目录，密钥与随机本机加密钥分文件保存；macOS / Linux 目录权限为 `0700`，文件权限为 `0600`。Windows 主密钥使用当前用户 DPAPI，目录与文件 DACL 限定当前用户和 SYSTEM；旧 master.v1.key 在校验服务密文及新格式回读成功后迁移为 master.v2.dpapi。该方案仍不隔离同一用户下的其他程序。

现行凭据流程不依赖每次构建的签名，也不在正常保存、读取、重启时访问 Keychain。旧存储的一次性迁移、删除语义与验证见[密钥持久化记录](validation/2026-10-24-private-credentials.md)。开发密钥、用户配置、克隆样本和录音不能随安装包或源码发布。

## 进一步阅读

- [本机诊断日志、导出和字段说明](diagnostics.md)

- [服务配置与协议边界](08-provider-configuration.md)
- [实时字幕优化记录](12-streamvox-optimization-progress.md)
- [虚拟麦克风、安装和卸载](../native/macos/virtual-mic/README.md)
- [Discord 实测与音质边界](13-virtual-microphone-and-monitoring.md)
- [微信虚拟麦克风调查](wechat-virtual-microphone-investigation.md)
- [设计文档目录](README.md)（含早期方案）


## 签名更新与发布

Windows 打包入口 `scripts/build-windows-installer.mjs` 会在 Tauri NSIS 之后封装前端安装界面，并重新签名最终 EXE。不能把内层安装器的 `.sig` 用到外层文件。安装窗口的后端位于 `src-tauri/src/setup.rs`，前端为 `src/components/Setup.tsx`；没有 WebView2 时保留原生兼容向导，应用内更新仍使用静默路径。详见 [安装器验证](validation/2026-10-25-windows-installer.md)。

应用更新使用 Tauri updater，公共验证密钥在 tauri.conf.json；签名私钥仅保存于受保护的本机目录以及 GitHub Actions Secret `TAURI_SIGNING_PRIVATE_KEY`，不得提交源码。可选密码使用 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。更新签名不同于 Windows Authenticode 或 Apple Developer ID 签名。

开发打包默认不生成更新产物；正式发布流水线通过配置启用 createUpdaterArtifacts。发布收集和清单检查由 scripts/prepare-release.mjs 执行，`npm run test:release` 验证校验拒绝、版本一致性及防止更新源降级。

`update-feed` 是只存 latest.json 的分发分支，不是应用开发分支。只有完整 Release 上传后才推进它；Windows x64、Windows ARM64、Mac ARM64 的签名产物分别使用 windows-x86_64、windows-aarch64、darwin-aarch64 键。客户端拒绝损坏的签名包，且要求签名中的版本与更新清单一致。启动时只检查，用户点击后才下载/安装；安装前两次检查未完成任务和未保存内容。
