mod saved;
mod vault;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;
use vault::{Master, Vault};
use zeroize::Zeroizing;
const SERVICE: &str = "com.voxbridge.desktop";
static SAVED: OnceLock<Mutex<saved::Saved>> = OnceLock::new();
pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法定位密钥目录。")?;
    let saved = saved::Saved::load(saved::daily_path(&directory), silent_master);
    saved.restore(session())?;
    SAVED
        .set(Mutex::new(saved))
        .map_err(|_| "密钥存储已初始化。".to_string())
}
fn saved() -> Result<std::sync::MutexGuard<'static, saved::Saved>, String> {
    SAVED
        .get()
        .ok_or("密钥存储尚未就绪。")?
        .lock()
        .map_err(|_| "密钥存储不可用。".into())
}
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
// Startup restores daily credentials once. Service calls never access Keychain.
pub fn read(id: &str) -> Result<String, String> {
    session().read(id)
}
pub async fn read_async(id: &str) -> Result<String, String> {
    read(id)
}
pub fn clear_session() {
    session().clear();
    if let Ok(saved) = saved() {
        saved.clear();
    }
}
fn silent_master(id: Option<&str>) -> Result<Master, String> {
    let id = id.ok_or("已保存密钥的标识无效。")?;
    #[cfg(target_os = "macos")]
    {
        use security_framework::item::{ItemClass, ItemSearchOptions, SearchResult};
        // Startup must never display authorization UI. A locked/replaced app is handled in Settings.
        let results = ItemSearchOptions::new()
            .class(ItemClass::generic_password())
            .service(SERVICE)
            .account(id)
            .load_data(true)
            .skip_authenticated_items(true)
            .search()
            .map_err(|_| "已保存密钥暂不可读取，请在设置中重新保存一次；原有密钥未删除。")?;
        let bytes = results
            .into_iter()
            .find_map(|item| match item {
                SearchResult::Data(bytes) => Some(Zeroizing::new(bytes)),
                _ => None,
            })
            .ok_or("已保存密钥暂不可读取，请在设置中重新保存一次。")?;
        let key = Zeroizing::new(hex::decode(&*bytes).map_err(|_| "密钥加密信息无效。")?);
        if key.len() != 32 {
            return Err("密钥加密信息无效。".into());
        }
        Ok(Master { id: id.into(), key })
    }
    #[cfg(not(target_os = "macos"))]
    {
        os_master(Some(id))
    }
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
                    .map_err(|_| "密钥存储授权未完成，原有密钥未删除。")?,
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
                .map_err(|_| "无法授权保存密钥，请检查系统凭据存储。")?;
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
    validate_id(&id)?;
    let key = if secret.trim().is_empty() {
        session().read(&id)?
    } else {
        validate_secret(&secret)?;
        secret
    };
    let path = path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        {
            let mut saved = saved()?;
            saved.save(&id, &key, os_master)?;
            session().set(&id, &key)?;
        }
        session().unlock(&path, true, os_master)?;
        session().save(&path, &id)
    })
    .await
    .map_err(|_| "模板保存任务失败。".to_string())?
}
#[tauri::command]
pub async fn credential_status(id: String) -> Result<bool, String> {
    validate_id(&id)?;
    if session().read(&id).is_err() {
        saved()?.status()?;
    }
    Ok(session().read(&id).is_ok())
}
#[tauri::command]
pub async fn set_credential(id: String, secret: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let secret = if secret.trim().is_empty() {
            session().read(&id)?
        } else {
            secret
        };
        let mut saved = saved()?;
        saved.save(&id, &secret, os_master)?;
        session().set(&id, &secret)
    })
    .await
    .map_err(|_| "密钥保存任务失败。".to_string())?
}
#[tauri::command]
pub async fn remove_credential(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_id(&id)?;
        let mut saved = saved()?;
        saved.remove(&id)?;
        session().remove(&id)
    })
    .await
    .map_err(|_| "密钥移除任务失败。".to_string())?
}
// Historical paid fixtures opt in to the legacy test credentials explicitly; never linked into production.
#[cfg(test)]
pub(crate) fn set_for_test(id: String, secret: String) -> Result<(), String> {
    session().set(&id, &secret)
}
#[cfg(test)]
pub(crate) fn read_for_test(id: &str) -> Result<String, String> {
    if let Ok(secret) = read(id) {
        return Ok(secret);
    }
    let secret = entry(id)?.get_password().map_err(|_| "测试密钥不可用。")?;
    session().set(id, &secret)?;
    Ok(secret)
}

#[cfg(all(test, target_os = "macos"))]
#[test]
#[ignore = "manual isolated Keychain test using synthetic credentials only"]
fn saved_credentials_survive_process_restart() {
    const CHILD: &str = "VOXBRIDGE_CREDENTIAL_TEST_PATH";
    if let Some(path) = std::env::var_os(CHILD) {
        let saved = saved::Saved::load(path.into(), silent_master);
        saved.status().expect("noninteractive Keychain restore");
        let memory = Vault::default();
        saved.restore(&memory).unwrap();
        assert_eq!(
            memory.read("synthetic-profile").unwrap(),
            "synthetic-not-an-api-key"
        );
        return;
    }
    let directory = std::env::temp_dir().join(format!(
        "vox-os-credential-test-{}",
        hex::encode(vault::random(12).unwrap())
    ));
    let path = saved::daily_path(&directory);
    let master = os_master(None).expect("create isolated Keychain entry");
    let id = master.id.clone();
    let mut saved = saved::Saved::load(path.clone(), |_| {
        panic!("empty config cannot access Keychain")
    });
    let result = saved.save("synthetic-profile", "synthetic-not-an-api-key", |_| {
        Ok(master)
    });
    let child = result.map(|()| {
        std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "credentials::saved_credentials_survive_process_restart",
                "--ignored",
            ])
            .env(CHILD, path)
            .status()
            .unwrap()
    });
    entry(&id)
        .unwrap()
        .delete_credential()
        .expect("remove isolated Keychain entry");
    let _ = std::fs::remove_dir_all(directory);
    assert!(child.expect("save encrypted credentials").success());
}
