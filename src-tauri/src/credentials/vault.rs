use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use std::{collections::BTreeMap, path::Path, sync::Mutex};
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"VOXKEY01";
const MAX_FILE: u64 = 512 * 1024;
pub(super) struct Master {
    pub id: String,
    pub key: Zeroizing<Vec<u8>>,
}
#[derive(Default)]
struct Memory {
    session: BTreeMap<String, Zeroizing<String>>,
    templates: BTreeMap<String, Zeroizing<String>>,
    master: Option<Master>,
    attempted: bool,
}
#[derive(Default)]
pub(super) struct Vault(Mutex<Memory>);

pub(super) fn random(size: usize) -> Result<Vec<u8>, String> {
    let mut bytes = vec![0; size];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "无法生成加密随机数。")?;
    Ok(bytes)
}
fn key_id(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() < 8 + 1 + 38 + 12 + 16 || &bytes[..8] != MAGIC || bytes[8] != 38 {
        return Err("密钥模板文件格式无效。".into());
    }
    let id = std::str::from_utf8(&bytes[9..47]).map_err(|_| "模板标识无效。")?;
    if !id.starts_with("vault-") || !id[6..].bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("模板标识无效。".into());
    }
    Ok(id.into())
}
fn cipher(master: &Master) -> Result<aead::LessSafeKey, String> {
    aead::UnboundKey::new(&aead::AES_256_GCM, &master.key)
        .map(aead::LessSafeKey::new)
        .map_err(|_| "模板加密密钥无效。".into())
}
fn encrypt(
    master: &Master,
    values: &BTreeMap<String, Zeroizing<String>>,
) -> Result<Vec<u8>, String> {
    let public: BTreeMap<&str, &str> = values
        .iter()
        .map(|(id, key)| (id.as_str(), key.as_str()))
        .collect();
    let mut plaintext =
        Zeroizing::new(serde_json::to_vec(&public).map_err(|_| "无法编码密钥模板。")?);
    let nonce: [u8; 12] = random(12)?.try_into().map_err(|_| "随机数无效。")?;
    let mut header = MAGIC.to_vec();
    header.push(38);
    header.extend_from_slice(master.id.as_bytes());
    header.extend_from_slice(&nonce);
    cipher(master)?
        .seal_in_place_append_tag(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(&header),
            &mut *plaintext,
        )
        .map_err(|_| "模板加密失败。")?;
    header.extend_from_slice(&plaintext);
    Ok(header)
}
fn decrypt(master: &Master, bytes: &[u8]) -> Result<BTreeMap<String, Zeroizing<String>>, String> {
    if key_id(bytes)? != master.id {
        return Err("模板密钥标识不匹配。".into());
    }
    let nonce: [u8; 12] = bytes[47..59].try_into().map_err(|_| "模板随机数无效。")?;
    let mut body = Zeroizing::new(bytes[59..].to_vec());
    let plaintext = cipher(master)?
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(&bytes[..59]),
            &mut body,
        )
        .map_err(|_| "模板无法解密或已损坏。".to_string())?;
    let values: BTreeMap<String, String> =
        serde_json::from_slice(plaintext).map_err(|_| "模板内容无效。")?;
    if values.len() > 30
        || values.iter().any(|(id, key)| {
            super::validate_id(id).is_err() || super::validate_secret(key).is_err()
        })
    {
        return Err("模板内容超出限制。".into());
    }
    Ok(values
        .into_iter()
        .map(|(id, key)| (id, Zeroizing::new(key)))
        .collect())
}
fn load(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() <= MAX_FILE => std::fs::read(path)
            .map(Some)
            .map_err(|_| "无法读取加密模板。".into()),
        Ok(_) => Err("模板文件过大。".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("无法检查模板文件。".into()),
    }
}
impl Vault {
    pub fn read(&self, id: &str) -> Result<String, String> {
        super::validate_id(id)?;
        self.0
            .lock()
            .map_err(|_| "密钥状态不可用。")?
            .session
            .get(id)
            .map(|s| s.to_string())
            .ok_or("本次尚未设置密钥，请在设置中输入，或显式解锁模板。".into())
    }
    pub fn set(&self, id: &str, secret: &str) -> Result<(), String> {
        super::validate_id(id)?;
        super::validate_secret(secret)?;
        let mut memory = self.0.lock().map_err(|_| "密钥状态不可用。")?;
        if memory.session.len() >= 30 && !memory.session.contains_key(id) {
            return Err("本次密钥数量已达上限。".into());
        }
        memory
            .session
            .insert(id.into(), Zeroizing::new(secret.trim().into()));
        Ok(())
    }
    pub fn remove(&self, id: &str) -> Result<(), String> {
        super::validate_id(id)?;
        self.0
            .lock()
            .map_err(|_| "密钥状态不可用。")?
            .session
            .remove(id);
        Ok(())
    }
    pub fn flags(&self) -> Result<(bool, bool), String> {
        let m = self.0.lock().map_err(|_| "密钥状态不可用。")?;
        Ok((m.master.is_some(), !m.attempted))
    }
    pub fn clear(&self) {
        if let Ok(mut memory) = self.0.lock() {
            *memory = Memory::default();
        }
    }
    /// The only gate to OS credentials. It is consumed before access, including denial or failure.
    pub fn unlock(
        &self,
        path: &Path,
        create: bool,
        access: impl FnOnce(Option<&str>) -> Result<Master, String>,
    ) -> Result<(), String> {
        {
            let mut m = self.0.lock().map_err(|_| "密钥状态不可用。")?;
            if m.master.is_some() {
                return Ok(());
            }
            if m.attempted {
                return Err("本次已申请过模板授权；可手动输入使用，重新授权需重启应用。".into());
            }
            // Empty input never reaches the credential store or consumes the gate.
            if !create && !path.exists() {
                return Err("尚无已保存模板，请手动输入配置。".into());
            }
            m.attempted = true;
        }
        let file = load(path)?;
        let id = file.as_ref().map(|bytes| key_id(bytes)).transpose()?;
        let master = access(id.as_deref())?;
        let templates = match file {
            Some(bytes) => decrypt(&master, &bytes)?,
            None => BTreeMap::new(),
        };
        let mut m = self.0.lock().map_err(|_| "密钥状态不可用。")?;
        for (id, key) in &templates {
            m.session.entry(id.clone()).or_insert_with(|| key.clone());
        }
        m.templates = templates;
        m.master = Some(master);
        Ok(())
    }
    pub fn save(&self, path: &Path, id: &str) -> Result<(), String> {
        let mut m = self.0.lock().map_err(|_| "密钥状态不可用。")?;
        let secret = m
            .session
            .get(id)
            .cloned()
            .ok_or("请先输入本次使用的密钥。")?;
        if m.templates.len() >= 30 && !m.templates.contains_key(id) {
            return Err("模板数量已达上限。".into());
        }
        let mut next = m.templates.clone();
        next.insert(id.into(), secret);
        let encrypted = encrypt(m.master.as_ref().ok_or("请先在设置中解锁模板。")?, &next)?;
        let parent = path.parent().ok_or("模板路径无效。")?;
        std::fs::create_dir_all(parent).map_err(|_| "无法创建模板目录。")?;
        let temp = parent.join(format!(".credentials-{}.tmp", hex::encode(random(8)?)));
        let result = (|| {
            use std::io::Write;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temp).map_err(|_| "无法写入加密模板。")?;
            file.write_all(&encrypted)
                .and_then(|_| file.sync_all())
                .map_err(|_| "无法保存加密模板。")?;
            std::fs::rename(&temp, path).map_err(|_| "无法更新加密模板。")?;
            Ok::<(), String>(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        result?;
        m.templates = next;
        Ok(())
    }
}
#[cfg(test)]
mod tests;
