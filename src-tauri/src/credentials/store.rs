//! Private local storage, independent of executable signatures. The local master is
//! protected by user-only filesystem permissions and current-user DPAPI on Windows.
//! This does not isolate applications running as the same Windows user.
use super::crypto::{self, Master};
use std::{
    collections::BTreeMap,
    io::Write,
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;
pub(super) type Values = BTreeMap<String, Zeroizing<String>>;

pub(super) struct Store {
    directory: PathBuf,
    values: Values,
    master: Option<Master>,
    migration_failed: bool,
}
impl Store {
    pub fn open(directory: PathBuf) -> Result<Self, String> {
        if directory.exists() {
            private_directory(&directory)?;
        }
        let mut store = Self {
            directory,
            values: Values::new(),
            master: None,
            migration_failed: false,
        };
        #[cfg(target_os = "windows")]
        let legacy = !store.key_path().exists() && store.directory.join("master.v1.key").exists();
        #[cfg(target_os = "windows")]
        let bytes = if legacy {
            private_read(&store.directory.join("master.v1.key"), 32)?
        } else {
            private_read(&store.key_path(), 16_384)?
                .map(|data| super::windows::unprotect(&data))
                .transpose()?
        };
        #[cfg(not(target_os = "windows"))]
        let bytes = private_read(&store.key_path(), 32)?;
        if let Some(bytes) = bytes {
            if bytes.len() != 32 {
                return Err("本机加密密钥损坏；已保留原文件，请勿删除后重新生成。".into());
            }
            store.master = Some(master(bytes));
        }
        if let Some(bytes) = private_read(&store.path(), 512 * 1024)? {
            store.values = crypto::decrypt(
                store
                    .master
                    .as_ref()
                    .ok_or("本机加密密钥缺失，已保留凭据文件。")?,
                &bytes,
            )?;
        }
        #[cfg(target_os = "windows")]
        if legacy {
            // Validate the existing ciphertext above before touching the only working key.
            private_directory(&store.directory)?;
            store.write_master(&store.master.as_ref().unwrap().key)?;
            let protected =
                private_read(&store.key_path(), 16_384)?.ok_or("本机密钥迁移校验失败。")?;
            if super::windows::unprotect(&protected)?[..] != store.master.as_ref().unwrap().key[..]
            {
                return Err("本机密钥迁移校验失败，旧文件已保留。".into());
            }
        }
        #[cfg(target_os = "windows")]
        if let Some(old) = private_read(&store.directory.join("master.v1.key"), 32)? {
            // Also finishes a migration interrupted after writing the protected copy.
            if store
                .master
                .as_ref()
                .is_none_or(|master| master.key[..] != old[..])
            {
                return Err("新旧本机密钥不一致；原文件已保留。".into());
            }
            std::fs::remove_file(store.directory.join("master.v1.key"))
                .map_err(|_| "已保护本机密钥，但旧密钥清理失败。")?;
        }
        Ok(store)
    }
    fn path(&self) -> PathBuf {
        self.directory.join("keys.v1.enc")
    }
    fn key_path(&self) -> PathBuf {
        #[cfg(target_os = "windows")]
        return self.directory.join("master.v2.dpapi");
        #[cfg(not(target_os = "windows"))]
        self.directory.join("master.v1.key")
    }
    fn write_master(&self, bytes: &[u8]) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        let bytes = super::windows::protect(bytes)?;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(self.key_path())
            .map_err(|_| "无法创建本机加密密钥；未覆盖现有文件。")?;
        if file
            .write_all(&bytes)
            .and_then(|_| file.sync_all())
            .is_err()
        {
            let _ = std::fs::remove_file(self.key_path());
            return Err("无法保存本机加密密钥。".into());
        }
        Ok(())
    }
    pub fn read(&self, id: &str) -> Result<String, String> {
        super::validate_id(id)?;
        self.values.get(id).map(|s| s.to_string()).ok_or_else(|| {
            if self.migration_failed {
                "旧版密钥受系统权限限制，未能自动迁移。请保存一次密钥，此后重启无需重新设置。"
                    .into()
            } else {
                "尚未保存密钥，请在设置中输入并保存。".into()
            }
        })
    }
    pub fn contains(&self, id: &str) -> Result<bool, String> {
        super::validate_id(id)?;
        if self.values.contains_key(id) {
            return Ok(true);
        }
        if self.migration_failed {
            self.read(id)?;
        }
        Ok(false)
    }
    pub fn set(&mut self, id: &str, secret: &str) -> Result<(), String> {
        super::validate_id(id)?;
        super::validate_secret(secret)?;
        let mut next = self.values.clone();
        next.insert(id.into(), Zeroizing::new(secret.trim().into()));
        if next.len() > 30 {
            return Err("保存的密钥数量已达上限。".into());
        }
        self.commit(next)
    }
    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        super::validate_id(id)?;
        let mut next = self.values.clone();
        next.remove(id);
        self.commit(next)
    }
    fn commit(&mut self, next: Values) -> Result<(), String> {
        if next.len() > 30 {
            return Err("保存的密钥数量已达上限。".into());
        }
        private_directory(&self.directory)?;
        if self.master.is_none() {
            let bytes = Zeroizing::new(crypto::random(32)?);
            self.write_master(&bytes)?;
            self.master = Some(master(bytes));
        }
        crypto::write_encrypted(
            &self.path(),
            &crypto::encrypt(self.master.as_ref().unwrap(), &next)?,
        )?;
        self.values = next;
        self.migration_failed = false;
        Ok(())
    }
    pub fn migrate(
        &mut self,
        parent: &Path,
        mut access: impl FnMut(&str) -> Result<Master, String>,
    ) -> Result<(), String> {
        if self.path().exists() {
            return Ok(());
        }
        let mut recovered = Values::new();
        for name in ["saved-credentials.v1.enc", "credentials.v1.enc"] {
            let result = (|| {
                let Some(bytes) = crypto::load(&parent.join(name))? else {
                    return Ok(None);
                };
                let id = crypto::key_id(&bytes)?;
                crypto::decrypt(&access(&id)?, &bytes).map(Some)
            })();
            match result {
                Ok(Some(values)) => {
                    for (id, value) in values {
                        recovered.entry(id).or_insert(value);
                    }
                }
                Ok(None) => {}
                Err(_) => self.migration_failed = true,
            }
        }
        if !recovered.is_empty() {
            self.commit(recovered)?;
        }
        Ok(())
    }
    pub fn clear(&mut self) {
        self.values.clear();
        self.master = None;
    }
}
fn master(key: Zeroizing<Vec<u8>>) -> Master {
    let digest = ring::digest::digest(&ring::digest::SHA256, &key);
    Master {
        id: format!("vault-{}", hex::encode(&digest.as_ref()[..16])),
        key,
    }
}
fn is_link(meta: &std::fs::Metadata) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(target_os = "windows"))]
    {
        meta.file_type().is_symlink()
    }
}
fn private_directory(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if !meta.is_dir() || is_link(&meta) => return Err("凭据目录无效。".into()),
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            return Err("无法检查凭据目录。".into())
        }
        _ => {}
    }
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(|_| "无法创建私有凭据目录。")?;
    #[cfg(target_os = "windows")]
    super::windows::restrict(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法保护凭据目录权限。")?;
    }
    Ok(())
}
fn private_read(path: &Path, maximum: u64) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() && !is_link(&meta) && meta.len() <= maximum => {
            #[cfg(target_os = "windows")]
            super::windows::restrict(path)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                    .map_err(|_| "无法保护凭据文件权限。")?;
            }
            std::fs::read(path)
                .map(|bytes| Some(Zeroizing::new(bytes)))
                .map_err(|_| "无法读取本机凭据。".into())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        _ => Err("本机凭据文件无效，已保留原文件。".into()),
    }
}
#[cfg(test)]
mod tests;
