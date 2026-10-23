use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use std::{collections::BTreeMap, path::Path};
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"VOXKEY01";
const MAX_FILE: u64 = 512 * 1024;
pub(super) struct Master {
    pub id: String,
    pub key: Zeroizing<Vec<u8>>,
}
pub(super) fn random(size: usize) -> Result<Vec<u8>, String> {
    let mut bytes = vec![0; size];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "无法生成加密随机数。")?;
    Ok(bytes)
}
pub(super) fn key_id(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() < 8 + 1 + 38 + 12 + 16 || &bytes[..8] != MAGIC || bytes[8] != 38 {
        return Err("密钥文件格式无效。".into());
    }
    let id = std::str::from_utf8(&bytes[9..47]).map_err(|_| "凭据标识无效。")?;
    if !id.starts_with("vault-") || !id[6..].bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("凭据标识无效。".into());
    }
    Ok(id.into())
}
fn cipher(master: &Master) -> Result<aead::LessSafeKey, String> {
    aead::UnboundKey::new(&aead::AES_256_GCM, &master.key)
        .map(aead::LessSafeKey::new)
        .map_err(|_| "凭据加密密钥无效。".into())
}
pub(super) fn encrypt(
    master: &Master,
    values: &BTreeMap<String, Zeroizing<String>>,
) -> Result<Vec<u8>, String> {
    let public: BTreeMap<&str, &str> = values
        .iter()
        .map(|(id, key)| (id.as_str(), key.as_str()))
        .collect();
    let mut plaintext = Zeroizing::new(serde_json::to_vec(&public).map_err(|_| "无法编码密钥。")?);
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
        .map_err(|_| "凭据加密失败。")?;
    header.extend_from_slice(&plaintext);
    Ok(header)
}
pub(super) fn decrypt(
    master: &Master,
    bytes: &[u8],
) -> Result<BTreeMap<String, Zeroizing<String>>, String> {
    if key_id(bytes)? != master.id {
        return Err("凭据密钥标识不匹配。".into());
    }
    let nonce: [u8; 12] = bytes[47..59].try_into().map_err(|_| "凭据随机数无效。")?;
    let mut body = Zeroizing::new(bytes[59..].to_vec());
    let plaintext = cipher(master)?
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(&bytes[..59]),
            &mut body,
        )
        .map_err(|_| "凭据无法解密或已损坏。".to_string())?;
    let values: BTreeMap<String, String> =
        serde_json::from_slice(plaintext).map_err(|_| "凭据内容无效。")?;
    if values.len() > 30
        || values.iter().any(|(id, key)| {
            super::validate_id(id).is_err() || super::validate_secret(key).is_err()
        })
    {
        return Err("凭据内容超出限制。".into());
    }
    Ok(values
        .into_iter()
        .map(|(id, key)| (id, Zeroizing::new(key)))
        .collect())
}
pub(super) fn load(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() <= MAX_FILE => std::fs::read(path)
            .map(Some)
            .map_err(|_| "无法读取加密凭据。".into()),
        Ok(_) => Err("凭据文件过大。".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("无法检查凭据文件。".into()),
    }
}
pub(super) fn write_encrypted(path: &Path, encrypted: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("凭据路径无效。")?;
    std::fs::create_dir_all(parent).map_err(|_| "无法创建凭据目录。")?;
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
        let mut file = options.open(&temp).map_err(|_| "无法写入加密凭据。")?;
        file.write_all(encrypted)
            .and_then(|_| file.sync_all())
            .map_err(|_| "无法保存加密凭据。")?;
        std::fs::rename(&temp, path).map_err(|_| "无法更新加密凭据。")?;
        Ok::<(), String>(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result?;
    Ok(())
}
