# 2026-10-23 设置页重复钥匙串提示修复

> 此记录为前一版修复。当前已进一步改为会话内存与一次显式模板授权，连状态查询也不再访问 OS。见[新说明](2026-10-23-session-templates.md)。

问题：设置页每次切换服务分类 / 配置都会调用 `credential_status`。旧实现通过 `keyring::Entry::get_password()` 判断是否已配置，实际请求了密钥内容，触发 macOS 钥匙串访问授权。普通设置保存本身不需要读取密钥。

修复：macOS 改用 Security.framework 的精确 service / account 元数据查询，明确关闭密码数据和引用返回，并设置跳过需要认证的条目。状态查询不触发授权界面，也不使用 `keyring::get_attributes()`；本机该库的 macOS 默认实现仍会间接读取 secret。查询放在后台线程，UI 未完成检查 / 检查失败时不再直接显示“未配置”。

参考 Apple 官方[查询结果字段](https://developer.apple.com/documentation/security/item-return-result-keys)和[无认证提示搜索](https://developer.apple.com/documentation/localauthentication/accessing-keychain-items-with-face-id-or-touch-id)。API 密钥仍保存在系统凭据存储；没有修改条目 ACL、允许所有应用访问或绕过真正读取密钥时的系统授权。后者仍可能在首次真实使用、钥匙串锁定或本地开发包签名变化后出现，不承诺永远不提示。

验证：

- 在本机对 4 个已存在测试凭据循环查询 5 次，加 5 次不存在项，共 25 次：结果正确，不读取密钥内容，不触发密码框；没有保存 / 删除任何凭据，也没有调用供应商。
- 打包应用中连续切换翻译 / ASR / TTS / 翻译四次，均显示正确的已配置状态；普通 API 根地址编辑保存后再恢复原地址保存，两次均无密码框。没有修改或重新保存 API 密钥，用户输入已保留。
- 默认 Rust 68 项测试通过，16 项实机 / 付费 / 辅助用例默认忽略；前端 70 项通过。
- 严格 Clippy、格式、Mac `.app` 构建和签名校验通过。

手动状态测试只查询元数据：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --locked live_metadata_status_is_promptless_and_does_not_read_secrets -- --ignored --nocapture
```
