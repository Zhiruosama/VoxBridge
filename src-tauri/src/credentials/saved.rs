//! Daily credentials are separate from optional, explicitly unlocked templates.
use super::{vault::Master, Vault};
use std::path::{Path, PathBuf};

pub(super) struct Saved {
    path: PathBuf,
    vault: Vault,
    error: Option<String>,
}
impl Saved {
    pub fn load(
        path: PathBuf,
        access: impl FnOnce(Option<&str>) -> Result<Master, String>,
    ) -> Self {
        let mut saved = Self {
            path,
            vault: Vault::default(),
            error: None,
        };
        if saved.path.exists() {
            if let Err(error) = saved.vault.unlock(&saved.path, false, access) {
                // A silent startup failure may be retried only by an explicit settings save.
                saved.vault.clear();
                saved.error = Some(error);
            }
        }
        saved
    }
    pub fn restore(&self, session: &Vault) -> Result<(), String> {
        for (id, secret) in self.vault.values()? {
            session.set(&id, &secret)?;
        }
        Ok(())
    }
    pub fn status(&self) -> Result<(), String> {
        self.error.clone().map_or(Ok(()), Err)
    }
    pub fn save(
        &mut self,
        id: &str,
        secret: &str,
        access: impl FnOnce(Option<&str>) -> Result<Master, String>,
    ) -> Result<(), String> {
        super::validate_id(id)?;
        super::validate_secret(secret)?;
        self.vault.unlock(&self.path, true, access)?;
        let old = self.vault.read(id).ok();
        self.vault.set(id, secret)?;
        if let Err(error) = self.vault.save(&self.path, id) {
            if let Some(old) = old {
                self.vault.set(id, &old)?;
            } else {
                self.vault.remove(id)?;
            }
            return Err(error);
        }
        self.error = None;
        Ok(())
    }
    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        self.status()?;
        if self.path.exists() {
            self.vault.delete_saved(&self.path, id)?;
        }
        Ok(())
    }
    pub fn clear(&self) {
        self.vault.clear();
    }
}

pub(super) fn daily_path(directory: &Path) -> PathBuf {
    directory.join("saved-credentials.v1.enc")
}

#[cfg(test)]
mod tests {
    use super::*;
    use zeroize::Zeroizing;
    fn master(_: Option<&str>) -> Result<Master, String> {
        Ok(Master {
            id: format!("vault-{}", "2".repeat(32)),
            key: Zeroizing::new(vec![9; 32]),
        })
    }
    #[test]
    fn save_restart_update_and_delete_without_loading_templates() {
        let directory = std::env::temp_dir().join(format!(
            "vox-saved-{}",
            hex::encode(crate::credentials::vault::random(12).unwrap())
        ));
        let path = daily_path(&directory);
        let mut saved = Saved::load(path.clone(), |_| {
            panic!("empty config cannot access keychain")
        });
        saved.save("profile", "first-secret", master).unwrap();
        saved
            .save("profile", "updated-secret", |_| {
                panic!("edits reuse cached master")
            })
            .unwrap();
        saved
            .save("other", "other-secret", |_| panic!("reuse cached master"))
            .unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert!(!bytes.windows(6).any(|w| w == b"secret"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let session = Vault::default();
        let mut restarted = Saved::load(path.clone(), master);
        restarted.restore(&session).unwrap();
        assert_eq!(session.read("profile").unwrap(), "updated-secret");
        assert!(session.read("blank-profile").is_err());
        restarted.remove("profile").unwrap();
        let session = Vault::default();
        Saved::load(path, master).restore(&session).unwrap();
        assert!(session.read("profile").is_err());
        assert_eq!(session.read("other").unwrap(), "other-secret");
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn startup_failure_never_overwrites_saved_keys_and_manual_retry_is_bounded() {
        let directory = std::env::temp_dir().join(format!(
            "vox-saved-{}",
            hex::encode(crate::credentials::vault::random(12).unwrap())
        ));
        let path = daily_path(&directory);
        let mut saved = Saved::load(path.clone(), master);
        saved.save("profile", "original-secret", master).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let mut denied = Saved::load(path.clone(), |_| Err("locked".into()));
        assert!(denied.status().is_err());
        assert!(denied.remove("profile").is_err());
        assert!(denied
            .save("profile", "new-secret", |_| Err("denied".into()))
            .is_err());
        assert!(denied
            .save("profile", "new-secret", |_| panic!(
                "must not authorize twice"
            ))
            .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let session = Vault::default();
        Saved::load(path, master).restore(&session).unwrap();
        assert_eq!(session.read("profile").unwrap(), "original-secret");
        std::fs::remove_dir_all(directory).unwrap();
    }
}
