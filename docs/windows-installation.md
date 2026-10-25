# Windows 安装、更新与卸载

## 安装

运行 `VoxBridge_<版本>_x64-setup.exe`。安装包携带完整、未修改的 VB-CABLE 基础版官方驱动包，校验 SHA-256 和安装程序数字签名。未检测到驱动时，交互安装会询问是否安装虚拟麦克风；选择安装后，在 Windows 权限提示中允许管理员操作，再在 VB-Audio 官方安装器点击 **Install Driver**，最后按提示重启电脑。取消驱动安装不影响 VoxBridge 本身的安装。

VB-CABLE 来源：www.vb-cable.com；这是 VB-Audio 提供的捐赠软件，欢迎支持作者。分发依据：[VB-CABLE Distribution with other product](https://vb-audio.com/Services/licensing.htm)。完整原始 readme 和许可文本保留在驱动目录。仅使用基础版，不分发 A+B/C+D。面向企业等用户不能自行支付许可的场景，应按官方说明办理相应许可。

静默安装、被动安装、软件更新或驱动已存在时不会自动启动驱动安装器。需要时可从开始菜单 **VoxBridge → VB-CABLE - Install or Uninstall**，或软件的 **设置 → 常规 → 虚拟麦克风 → 安装或卸载驱动** 打开。

在 VoxBridge 选择 **CABLE Input** 为发送设备并保存，在 Oopz、KOOK、Discord 等软件中选择 **CABLE Output** 为麦克风。也可在 Windows 声音设置中把对应端点显示名改为 **VoxBridge**，此时选择 VoxBridge；程序仍检查 VB-Audio 厂商信息，并使用稳定端点 ID 进行路由。改名不会把 VB-CABLE 变成自有驱动。试听使用真实耳机或扬声器。

## 更新

直接运行新版本安装包，不需要先卸载旧版。交互安装器检测到已有的 VoxBridge 后，自动启用数据保留更新模式；程序使用之前的安装位置，并保留配置、字幕设置、模型服务配置和凭据。更新不会卸载或再次安装 VB-CABLE。

安装器供自动更新调用时使用 `/S /UPDATE`；手动更新直接双击即可。应用标识 `com.voxbridge.desktop` 及原有配置/凭据存放位置保持稳定。换 Windows 用户、迁移到另一台电脑或主动清除应用数据不属于原机覆盖更新。

启动时会检查签名更新源，也可在 **设置 → 常规 → 关于 → 检查更新** 手动检查；有新版本时点击 **更新并重启**。监听、录音、未处理队列、输入草稿或未保存设置存在时不安装。下载后会再次检查任务状态，并验证包签名与签名版本，再交给安装器覆盖更新。新更新包要等下一次实际发布后才会出现在更新源。

## 卸载

- **VoxBridge**：Windows“已安装的应用”、开始菜单 **VoxBridge → Uninstall VoxBridge**，或安装目录下的 `uninstall.exe`。
- **虚拟麦克风**：开始菜单的 **VB-CABLE - Install or Uninstall** 打开官方管理器，点击 **Remove Driver**，最后按提示重启电脑。官方驱动使用同一份 `VBCABLE_Setup_x64.exe` 安装和卸载，没有另一个官方 `uninstall.exe`。
- 交互卸载 VoxBridge 时也会询问是否打开驱动卸载程序，默认保留驱动，防止影响其他共用它的软件。更新及无人值守卸载不打开这个提示。若需要一起卸载，在移除 VoxBridge 文件之前完成驱动卸载。
- 普通卸载的清除应用数据选项默认不选；主动勾选才会删除应用配置及凭据目录。覆盖更新模式禁止执行这一步。

驱动与管理器位于安装目录的 `virtual-microphone` 子目录，软件自身的 `uninstall.exe` 位于安装目录根目录。若已卸载 VoxBridge 并保留驱动，之后可重新下载 VB-CABLE 官方原包，用相同的官方管理器卸载。
