# Windows 虚拟麦克风（VB-CABLE）

[开发与打包](../../docs/development.md) · [用户安装指南](../../docs/guides/getting-started.md)

本文面向开发和驱动维护。普通安装与使用请从用户指南开始。

Windows 首版使用 VB-Audio 官方已签名的基础版 VB-CABLE Pack45，由 VoxBridge 提供安装引导、两端检测与发送设备快捷设置。默认使用厂商名称，也支持通过 Windows 设置把端点显示名改为 VoxBridge；驱动和签名仍属于 VB-Audio，不作为自有驱动。

## 使用

1. 常规 → 音频 → 安装虚拟麦克风。允许 Windows 权限请求，在 VB-CABLE 安装器中点击 **Install Driver**。
2. 按厂商要求重启电脑。重新打开 VoxBridge，刷新设备，确认 VB-CABLE 已就绪。
3. 点击「用作发送设备」。试听设备选择真实耳机或扬声器，保存更改。
4. Oopz、KOOK、Discord 等聊天软件的麦克风选择 **CABLE Output (VB-Audio Virtual Cable)**。VoxBridge 发送到 **CABLE Input (VB-Audio Virtual Cable)**。
5. 在 VoxBridge 发送一段语音，在聊天软件的麦克风测试中验收。发送时试听可独立开关；关闭试听不会关闭发送。

驱动管理器会在申请管理员权限前记录当前用户的默认输入、输出及通信设备。厂商安装器若将默认项切到 VB-CABLE，管理器会恢复原先仍在线的设备；首次安装后还会在下次登录检查一次，之后删除恢复任务。不会将 VB-CABLE 主动设为默认，也不会覆盖期间新选的实体设备。恢复失败会提示检查 Windows 声音设置。只有一端出现时先重启，检查声音设置中两端是否启用，再刷新。不要启用 Windows 的「侦听此设备」并同时打开应用试听，避免重复回放。虚拟录音端不会出现在 VoxBridge 的语音输入麦克风列表，防止自身回采。

卸载驱动使用 VB-CABLE 官方安装器的 Remove Driver，并按提示重启；卸载 VoxBridge 默认保留共享驱动，交互卸载时可选择先打开驱动卸载程序。开始菜单和软件设置页都有驱动管理入口。安装、覆盖更新与卸载详见 [Windows 安装指南](../../docs/windows-installation.md)。

## 来源、许可与构建

VB-CABLE is a donationware, all participations are welcome.

- 作者与来源：[VB-Audio / www.vb-cable.com](https://vb-audio.com/Cable/)。可从官网支持作者；专业组织使用应核对厂商授权条款。
- [厂商当前分发条款](https://vb-audio.com/Services/licensing.htm)中 “VB-CABLE Distribution with other product” 允许基础包随应用分发，要求保留来源与 Donationware 提示。原包 readme 与所有驱动文件保持不变；不捆绑 Cable A+B / C+D。
- 官方下载：https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip
- ZIP SHA-256：`b950e39f01af1d04ea623c8f6d8eb9b6ea5c477c637295fabf20631c85116bfb`。

`build-resources.ps1` 下载固定版本，校验 ZIP、逐文件摘要与 x64 安装器 Authenticode 签名，保留完整原始包。产物只进入被忽略的 `.build/`，Tauri Windows 配置将它包含在 `virtual-microphone/vb-cable/`。第一次构建需联网，之后可使用通过校验的缓存。更新厂商版本必须同步审核许可、签名和摘要清单。

点击安装时后端再次校验全部文件，之后打开固定厂商安装器，由 Windows 请求管理员权限。不静默安装、不自动重启。开发版安装路径缺失时才允许回退到工作区缓存，正式版仅使用随应用资源。

## 验证范围

设备识别限定基础版、枚举方向和厂商名称；接受默认名称及用户设置的 VoxBridge 别名，不将 Steam 或其他虚拟设备当作 VB-CABLE。两端都出现才允许快捷选为发送设备；部分缺失提示检查启用状态与重启。发送沿用现有稳定端点 ID 和独立试听路径。

自动测试与打包验证不能替代真实驱动回环/通话验收。安装驱动后需检查：静音试听仍能发送、试听开启不重复播放、发送取消、队列连续发送、实体麦克风输入、聊天软件收音和重启后的设备恢复。


默认设备保护实现与验证步骤见 [Windows 音频安装验证](../../docs/testing/windows-audio-installation.md)。设置页、开始菜单和安装器统一走同一管理脚本，只有厂商安装器提权；不会在 VoxBridge 日常启动时持续修改系统默认设备。
