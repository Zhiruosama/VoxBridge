mod crypto;
mod store;
use crypto::Master;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;
use zeroize::Zeroizing;
const SERVICE: &str = "com.voxbridge.desktop";
static STORE: OnceLock<Mutex<Result<store::Store, String>>> = OnceLock::new();

pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    let initialized = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法定位凭据目录。".to_string())
        .and_then(|directory| {
            let mut store = store::Store::open(directory.join("credentials"))?;
            store.migrate(&directory, legacy_master)?;
            Ok(store)
        });
    STORE
        .set(Mutex::new(initialized))
        .map_err(|_| "凭据存储已经初始化。".into())
}
fn with_store<T>(
    operation: impl FnOnce(&mut store::Store) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = STORE
        .get()
        .ok_or("凭据存储尚未就绪。")?
        .lock()
        .map_err(|_| "凭据存储不可用。")?;
    operation(guard.as_mut().map_err(|error| error.clone())?)
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
#[cfg(any(test, not(target_os = "macos")))]
fn entry(id: &str) -> Result<keyring::Entry, String> {
    validate_id(id)?;
    keyring::Entry::new(SERVICE, id).map_err(|_| "无法访问旧版凭据。".into())
}
// Normal reads, saves and deletes never access Keychain. Only legacy migration may
// attempt a noninteractive read once at startup, and only without a new store.
pub fn read(id: &str) -> Result<String, String> {
    #[cfg(test)]
    if let Some(secret) = test_values().lock().unwrap().get(id) {
        return Ok(secret.to_string());
    }
    with_store(|store| store.read(id))
}
pub async fn read_async(id: &str) -> Result<String, String> {
    read(id)
}
pub fn clear_session() {
    let _ = with_store(|store| {
        store.clear();
        Ok(())
    });
}
#[tauri::command]
pub async fn credential_status(id: String) -> Result<bool, String> {
    with_store(|store| store.contains(&id))
}
#[tauri::command]
pub async fn set_credential(id: String, secret: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_store(|store| {
            let secret = if secret.trim().is_empty() {
                store.read(&id)?
            } else {
                secret
            };
            store.set(&id, &secret)
        })
    })
    .await
    .map_err(|_| "密钥保存任务失败。".to_string())?
}
#[tauri::command]
pub async fn remove_credential(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || with_store(|store| store.remove(&id)))
        .await
        .map_err(|_| "密钥移除任务失败。".to_string())?
}
fn legacy_master(id: &str) -> Result<Master, String> {
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
        let encoded = Zeroizing::new(
            entry(id)?
                .get_password()
                .map_err(|_| "旧版凭据暂不可读取。")?,
        );
        let key = Zeroizing::new(hex::decode(encoded.as_str()).map_err(|_| "旧版凭据无效。")?);
        if key.len() != 32 {
            return Err("旧版凭据无效。".into());
        }
        Ok(Master { id: id.into(), key })
    }
}

#[cfg(test)]
fn test_values() -> &'static Mutex<store::Values> {
    static VALUES: OnceLock<Mutex<store::Values>> = OnceLock::new();
    VALUES.get_or_init(Mutex::default)
}
#[cfg(test)]
pub(crate) fn set_for_test(id: String, secret: String) -> Result<(), String> {
    validate_id(&id)?;
    validate_secret(&secret)?;
    test_values()
        .lock()
        .unwrap()
        .insert(id, Zeroizing::new(secret));
    Ok(())
}
#[cfg(test)]
pub(crate) fn read_for_test(id: &str) -> Result<String, String> {
    if let Ok(secret) = read(id) {
        return Ok(secret);
    }
    let secret = entry(id)?.get_password().map_err(|_| "测试密钥不可用。")?;
    set_for_test(id.into(), secret.clone())?;
    Ok(secret)
}

#[test]
#[cfg(all(test, target_os = "macos"))]
#[ignore = "manual one-time installed credential migration; never prints keys or displays authorization UI"]
fn migrate_installed_credentials() {
    let directory = std::path::PathBuf::from(std::env::var_os("HOME").unwrap())
        .join("Library/Application Support/com.voxbridge.desktop");
    let mut store = store::Store::open(directory.join("credentials")).unwrap();
    store.migrate(&directory, legacy_master).unwrap();
    println!(
        "INSTALLED_CREDENTIALS_RECOVERED: {}",
        [
            "provider-deepseek-flash",
            "provider-minimax-cn",
            "provider-qwen-realtime",
            "translation-default",
            "tts-default",
            "asr-default"
        ]
        .iter()
        .filter(|id| store.contains(id).unwrap_or(false))
        .count()
    );
}
