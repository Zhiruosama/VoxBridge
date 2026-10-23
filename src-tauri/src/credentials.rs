mod vault;
use std::sync::OnceLock;
use tauri::Manager;
use vault::{Master, Vault};
use zeroize::Zeroizing;
const SERVICE: &str = "com.voxbridge.desktop";
fn session() -> &'static Vault {
    static SESSION: OnceLock<Vault> = OnceLock::new();
    SESSION.get_or_init(Vault::default)
}
fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        Err("服务标识无效。".into())
    } else {
        Ok(())
    }
}
fn validate_secret(secret: &str) -> Result<(), String> {
    if secret.trim().is_empty() || secret.len() > 8192 {
        Err("密钥为空或长度超出限制。".into())
    } else {
        Ok(())
    }
}
fn entry(id: &str) -> Result<keyring::Entry, String> {
    validate_id(id)?;
    keyring::Entry::new(SERVICE, id).map_err(|_| "无法访问系统凭据存储。".into())
}
// Service calls are memory-only. Never fall back to Keychain, including after denial or restart.
pub fn read(id: &str) -> Result<String, String> {
    session().read(id)
}
pub async fn read_async(id: &str) -> Result<String, String> {
    read(id)
}
pub fn clear_session() {
    session().clear();
}
fn path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("credentials.v1.enc"))
        .map_err(|_| "无法定位模板目录。".into())
}
fn os_master(id: Option<&str>) -> Result<Master, String> {
    match id {
        Some(id) => {
            let encoded = Zeroizing::new(
                entry(id)?
                    .get_password()
                    .map_err(|_| "模板授权未完成；本次不再请求，可手动输入密钥使用。")?,
            );
            let key =
                Zeroizing::new(hex::decode(encoded.as_str()).map_err(|_| "模板加密密钥无效。")?);
            if key.len() != 32 {
                return Err("模板加密密钥无效。".into());
            }
            Ok(Master { id: id.into(), key })
        }
        None => {
            let id = format!("vault-{}", hex::encode(vault::random(16)?));
            let key = Zeroizing::new(vault::random(32)?);
            let encoded = Zeroizing::new(hex::encode(&key));
            entry(&id)?
                .set_password(encoded.as_str())
                .map_err(|_| "无法授权保存模板；本次仍可手动输入密钥使用。")?;
            Ok(Master { id, key })
        }
    }
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateStatus {
    unlocked: bool,
    can_unlock: bool,
    has_saved: bool,
}
#[tauri::command]
pub fn template_status(app: tauri::AppHandle) -> Result<TemplateStatus, String> {
    let (unlocked, can_unlock) = session().flags()?;
    Ok(TemplateStatus {
        unlocked,
        can_unlock,
        has_saved: path(&app)?.exists(),
    })
}
#[tauri::command]
pub async fn unlock_templates(app: tauri::AppHandle) -> Result<(), String> {
    let path = path(&app)?;
    tauri::async_runtime::spawn_blocking(move || session().unlock(&path, false, os_master))
        .await
        .map_err(|_| "模板解锁任务失败。".to_string())?
}
#[tauri::command]
pub async fn save_template_credential(
    app: tauri::AppHandle,
    id: String,
    secret: String,
) -> Result<(), String> {
    // Validate an actual key before any disk / authorization work.
    if !secret.trim().is_empty() {
        session().set(&id, &secret)?;
    } else {
        session().read(&id)?;
    }
    let path = path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        session().unlock(&path, true, os_master)?;
        session().save(&path, &id)
    })
    .await
    .map_err(|_| "模板保存任务失败。".to_string())?
}
#[tauri::command]
pub async fn credential_status(id: String) -> Result<bool, String> {
    validate_id(&id)?;
    Ok(session().read(&id).is_ok())
}
#[tauri::command]
pub fn set_credential(id: String, secret: String) -> Result<(), String> {
    session().set(&id, &secret)
}
#[tauri::command]
pub fn remove_credential(id: String) -> Result<(), String> {
    session().remove(&id)
}
// Historical paid fixtures opt in to the legacy test credentials explicitly; never linked into production.
#[cfg(test)]
pub(crate) fn read_for_test(id: &str) -> Result<String, String> {
    if let Ok(secret) = read(id) {
        return Ok(secret);
    }
    let secret = entry(id)?.get_password().map_err(|_| "测试密钥不可用。")?;
    session().set(id, &secret)?;
    Ok(secret)
}
