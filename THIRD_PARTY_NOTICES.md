# 许可范围与第三方组件

VoxBridge 自有代码采用根目录的 [PolyForm Noncommercial 1.0.0](LICENSE)。允许用途、修改、分发及必须保留的通知以许可原文为准。商业用途不在该许可授予范围内，需要先联系[项目维护者](https://github.com/Zhiruosama)取得单独授权。

该许可不替代第三方原有许可，也不限制第三方许可已经授予的权利。已有版权声明、许可证和厂商说明应保留。

| 组件 | 原有许可与说明 |
| --- | --- |
| macOS 虚拟麦克风中的 Apple AudioServerPlugIn 示例及其衍生驱动 | 保留 [Apple MIT 许可](native/macos/virtual-mic/LICENSE-Apple.txt)，来源和修改说明见[驱动文档](native/macos/virtual-mic/README.md)。不以根目录非商业许可替换该驱动已有的许可声明。 |
| Noto Sans SC 字体 | 保留 [SIL Open Font License 1.1](public/licenses/Noto-Sans-SC-OFL.txt)。 |
| Windows 随包提供的 VB-CABLE | 属于 VB-Audio，遵循厂商自己的许可和分发条件，不属于 VoxBridge 的非商业许可授权范围。保留完整原包、厂商来源和 Donationware 提示，详见 [Windows 驱动来源与许可](native/windows/README.md#来源许可与构建)。 |
| npm 与 Rust 第三方依赖 | 各自遵循原作者的许可证。依赖和固定版本记录于 `package-lock.json`、`src-tauri/Cargo.lock`；分发时仍须遵守相应的版权与通知要求。上表不是所有依赖的逐项清单。 |

云服务、API、模型和用户自行提供的克隆音色受相应供应商及权利人的条款约束，仓库许可不授予这些内容的额外使用权。

本次许可声明随当前源码及后续构建提供，不改写已发布标签或安装包中的文件。获取旧版本时，应核对该版本实际附带的许可声明。
