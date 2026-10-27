# Windows 虚拟麦克风安装验证

[文档中心](../README.md) · [Windows 安装指南](../windows-installation.md)

## 这次诊断能确认什么

收到的 Windows 诊断共 102 条记录：有设备枚举、虚拟麦克风检测和设置保存，没有语音合成、播放、测试音或录音操作，也没有错误事件。旧日志的检测成功只代表命令执行完成，没有记录两端是否就绪。因此不能从这份日志断言 QQ 已收到声音，也不能确定静音的唯一原因。

现在虚拟麦克风检测会记录两端数量、是否部分缺失及就绪状态，不记录设备名、设备 ID 或声音。设置页提供显式指向虚拟输出的测试音，并提示尚未选择发送设备的情况。测试音不调用付费模型。

## 默认设备保护

所有 VoxBridge 驱动入口使用 `Manage-Virtual-Microphone.ps1`：

1. 校验随包原始厂商文件及安装器签名，在原用户进程记录 Core Audio 的输入 / 输出各三个角色（普通、多媒体、通信）的默认端点。
2. 只提升官方驱动安装器权限，不提升用于保存默认设备的脚本。
3. 安装器结束后短暂检查设备激活状态。仅当默认项被切到基础版 VB-CABLE，且原端点仍在线、方向一致时，恢复原默认项。当前已选择其他实体设备时不覆盖。
4. 首次安装注册当前用户的一次性 RunOnce 恢复，覆盖驱动需要重启才激活的情况。恢复脚本和快照位于 `%LOCALAPPDATA%\VoxBridge\DriverSetup`，下次登录执行后删除；快照有效期七天。不添加常驻启动监视器。

系统或厂商在安装过程中仍可能短暂切换默认设备。恢复使用 Windows Core Audio 枚举和兼容性 `IPolicyConfig` 设置接口；这不是公开承诺稳定的 Windows 默认设备设置 API，失败时提示人工检查，不选择任意替代设备。电脑重新启动 / 登录前请不要主动将默认设备改成 VB-CABLE，以免一次性恢复将其视为安装器的修改。

依据：[VB-CABLE 官方手册](https://vb-audio.com/Cable/VBCABLE_ReferenceManual.pdf)、[Microsoft 默认端点角色](https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-immdeviceenumerator-getdefaultaudioendpoint)、[EarTrumpet 的 IPolicyConfig 定义](https://github.com/File-New-Project/EarTrumpet/blob/master/EarTrumpet/Interop/MMDeviceAPI/IPolicyConfig.cs)。基础厂商包保持原样。

## 自动验证范围

`native/windows/Audio-Defaults.Tests.ps1` 编译互操作声明，测试六个角色、原设备离线、用户换设备、无默认设备、厂商身份与打包资源。CI 在 Windows x64 / ARM64 使用 Windows PowerShell 5.1 运行；测试不读取或改变机器默认设备。macOS 上的 PowerShell 编译与策略测试不能替代真实 Windows 驱动测试。

## 真实 Windows 验收

使用无 VB-CABLE 的 Windows 电脑或带音频硬件的干净环境，记录以下结果：

- 安装前记录播放、录音的默认设备及默认通信设备；安装后及重启后都应维持原设备。拒绝 UAC、取消厂商安装、重试、卸载、覆盖更新也要检查。
- 确认 CABLE Input 和 CABLE Output 都启用。VoxBridge 中选 CABLE Input 作为发送设备，试听保留真实耳机；QQ / Discord 麦克风选 CABLE Output。
- 无通话时点击「测试虚拟麦克风」，观察聊天软件测试输入，再发送实际生成的语音。不要依靠系统默认麦克风碰巧切到了 VB-CABLE 来证明路由成功。
- 测试安装期间主动改选另一实体设备、拔掉原设备，确认不会被强制改回。检查下一次登录后 RunOnce 和快照已清理。
- QQ / 微信 / Discord 分别记录能否枚举、能否收音和有无失真。驱动枚举成功不代表这些软件均已通过验证。

维护者可在没有通话时使用已有的 `windows_cable_roundtrip` 忽略测试验证应用播放到虚拟输入的回环；它会发送三个测试音，不能在通话中运行。
