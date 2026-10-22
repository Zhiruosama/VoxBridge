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

#[tauri::command]
pub fn credential_status(id: String) -> Result<bool, String> {
    match entry(&id)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err("无法读取凭据状态，请检查系统凭据存储。".into()),
    }
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
