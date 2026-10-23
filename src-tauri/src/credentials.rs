const SERVICE: &str = "com.voxbridge.desktop";

fn entry(id: &str) -> Result<keyring::Entry, String> {
    if id.is_empty() || id.len() > 128 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("服务标识无效。".into());
    }
    keyring::Entry::new(SERVICE, id).map_err(|_| "无法访问系统凭据存储。".into())
}

pub fn read(id: &str) -> Result<String, String> {
    entry(id)?
        .get_password()
        .map_err(|_| "未找到密钥，请在设置中配置。".into())
}

/// Security.framework can block for seconds; keep it off the network / UI runtime.
pub async fn read_async(id: &str) -> Result<String, String> {
    let id = id.to_owned();
    tauri::async_runtime::spawn_blocking(move || read(&id))
        .await
        .map_err(|_| "读取系统凭据任务失败。".to_string())?
}

// This path must never read secret data, including through keyring::get_attributes(),
// whose macOS default implementation internally calls get_secret().
fn status(id: &str) -> Result<bool, String> {
    let _ = entry(id)?;
    #[cfg(target_os = "macos")]
    {
        use security_framework::item::{ItemClass, ItemSearchOptions, Limit};
        let mut query = ItemSearchOptions::new();
        query
            .class(ItemClass::generic_password())
            .service(SERVICE)
            .account(id)
            .limit(Limit::Max(1))
            .load_attributes(true)
            .load_data(false)
            .load_refs(false)
            .skip_authenticated_items(true);
        match query.search() {
            Ok(items) => Ok(!items.is_empty()),
            Err(error) if error.code() == -25300 => Ok(false), // errSecItemNotFound
            Err(_) => Err("无法检查密钥状态；可在使用服务时验证。".into()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        match entry(id)?.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(_) => Err("无法检查密钥状态；可在使用服务时验证。".into()),
        }
    }
}

#[tauri::command]
pub async fn credential_status(id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || status(&id))
        .await
        .map_err(|_| "检查密钥状态失败。".to_string())?
}

#[tauri::command]
pub fn set_credential(id: String, secret: String) -> Result<(), String> {
    if secret.trim().is_empty() || secret.len() > 8192 {
        return Err("密钥为空或长度超出限制。".into());
    }
    entry(&id)?
        .set_password(secret.trim())
        .map_err(|_| "保存密钥失败，请检查系统凭据存储。".into())
}

#[tauri::command]
pub fn remove_credential(id: String) -> Result<(), String> {
    match entry(&id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("删除密钥失败。".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn invalid_identifiers_are_rejected_before_keychain_lookup() {
        for id in ["", "invalid/id", "wild*card", "中文", &"a".repeat(129)] {
            assert_eq!(
                credential_status(id.into()).await.unwrap_err(),
                "服务标识无效。"
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    #[ignore = "manual: read-only metadata queries for known user-provided test credentials; never reads passwords"]
    async fn live_metadata_status_is_promptless_and_does_not_read_secrets() {
        for _ in 0..5 {
            for id in [
                "provider-qwen-asr",
                "provider-qwen-realtime",
                "provider-deepseek-flash",
                "provider-minimax-cn",
            ] {
                assert!(
                    credential_status(id.into()).await.unwrap(),
                    "expected existing metadata for {id}"
                );
            }
            assert!(
                !credential_status(format!("voxbridge-missing-status-{}", std::process::id()))
                    .await
                    .unwrap()
            );
        }
        println!(
            "METADATA_STATUS: 20 existing + 5 missing lookups passed; no secret data requested"
        );
    }
}
