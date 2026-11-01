# Windows 打包宿主启动导致配置目录分离

现场确认同一个安装文件 `D:\VoxBridge\voxbridge.exe`，通过 Codex 宿主启动和通过 Explorer/桌面启动可能访问不同的 AppData 实体目录。进程命令行中的 WebView 数据目录看起来相同，不能据此排除 Windows 打包宿主的文件系统重定向。

本次完整设置位于 `AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/com.voxbridge.desktop`；用户正常启动所读取的 `AppData/Local/com.voxbridge.desktop` 则是空白服务配置。API 密钥独立存储，现场显示已保存，不能据此判断服务地址、模型和音色已正常加载。

恢复在用户正常退出软件后，从不继承打包宿主身份的 Windows 进程执行。先保留正常目录的原始 LevelDB，再复制已确认完整的配置数据库，保留凭据目录。恢复后通过普通 Windows 环境启动，并在用户实际窗口确认 DeepSeek 模型、Frieren 音色、日语和 1.10× 语速恢复。

后续本机更新验证要求：

- 保留配置目录和凭据，不以应用标识、表面路径一致或某次启动成功作为配置保留的充分证据。
- 从普通 Windows 环境或用户桌面入口启动，并核对用户实际窗口；不要从打包开发宿主继承的进程中启动后直接宣称验证成功。
- 配置只在软件和相关 WebView 正常退出后恢复；等待进程不能依赖聊天回合结束后仍存活。
- 本次修复是正常用户数据目录的恢复，没有修改配置解析规则，没有把任何用户密钥提交到仓库。
