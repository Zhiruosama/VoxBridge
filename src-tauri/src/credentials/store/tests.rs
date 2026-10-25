use super::*;
#[cfg(target_os = "windows")]
#[test]
fn migrates_plain_master_to_current_user_dpapi_without_changing_credentials() {
    let folder = Folder::new();
    let directory = folder.0.join("credentials");
    std::fs::create_dir_all(&directory).unwrap();
    let key = Zeroizing::new(vec![7; 32]);
    let master = master(key.clone());
    let values = [(
        "synthetic".to_string(),
        Zeroizing::new("synthetic-secret".to_string()),
    )]
    .into_iter()
    .collect();
    let ciphertext = crypto::encrypt(&master, &values).unwrap();
    std::fs::write(directory.join("master.v1.key"), &key).unwrap();
    std::fs::write(directory.join("keys.v1.enc"), &ciphertext).unwrap();
    let store = Store::open(directory.clone()).unwrap();
    assert_eq!(store.read("synthetic").unwrap(), "synthetic-secret");
    assert!(!directory.join("master.v1.key").exists());
    assert_eq!(std::fs::read(store.path()).unwrap(), ciphertext);
    assert_ne!(std::fs::read(store.key_path()).unwrap(), key.to_vec());
    assert_eq!(
        Store::open(directory).unwrap().read("synthetic").unwrap(),
        "synthetic-secret"
    );
}
struct Folder(PathBuf);
impl Folder {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!(
            "vox-private-{}",
            hex::encode(crypto::random(12).unwrap())
        )))
    }
    fn store(&self) -> Store {
        Store::open(self.0.join("credentials")).unwrap()
    }
}
impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn old_master() -> Master {
    Master {
        id: format!("vault-{}", "3".repeat(32)),
        key: Zeroizing::new(vec![5; 32]),
    }
}
fn legacy_file(folder: &Folder, name: &str, pairs: &[(&str, &str)]) -> Vec<u8> {
    let values = pairs
        .iter()
        .map(|(id, key)| (id.to_string(), Zeroizing::new(key.to_string())))
        .collect();
    let bytes = crypto::encrypt(&old_master(), &values).unwrap();
    std::fs::create_dir_all(&folder.0).unwrap();
    std::fs::write(folder.0.join(name), &bytes).unwrap();
    bytes
}
#[test]
fn empty_profile_creates_nothing_and_never_accesses_system_credentials() {
    let folder = Folder::new();
    let mut store = folder.store();
    store
        .migrate(&folder.0, |_| panic!("no legacy files"))
        .unwrap();
    assert!(!store.contains("blank").unwrap());
    assert!(!folder.0.exists());
    assert!(store.set("bad/id", "secret").is_err());
    assert!(store.set("blank", " ").is_err());
    assert!(!folder.0.exists());
}
#[test]
fn saves_updates_removes_and_restarts_with_stable_local_master() {
    let folder = Folder::new();
    let mut store = folder.store();
    store.set("first", " test-secret ").unwrap();
    let master = std::fs::read(store.key_path()).unwrap();
    let original_cipher = std::fs::read(store.path()).unwrap();
    assert!(!original_cipher.windows(6).any(|window| window == b"secret"));
    store.set("first", "updated-secret").unwrap();
    store.set("other", "another-secret").unwrap();
    assert_eq!(std::fs::read(store.key_path()).unwrap(), master);
    let mut restarted = folder.store();
    assert_eq!(restarted.read("first").unwrap(), "updated-secret");
    restarted.remove("first").unwrap();
    let restarted = folder.store();
    assert!(!restarted.contains("first").unwrap());
    assert_eq!(restarted.read("other").unwrap(), "another-secret");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&store.directory)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        for path in [store.key_path(), store.path()] {
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
}
#[test]
fn migrates_old_formats_once_with_daily_keys_taking_priority() {
    let folder = Folder::new();
    let old = legacy_file(
        &folder,
        "credentials.v1.enc",
        &[("first", "template-secret"), ("second", "other-secret")],
    );
    legacy_file(
        &folder,
        "saved-credentials.v1.enc",
        &[("first", "daily-secret")],
    );
    let mut store = folder.store();
    store.migrate(&folder.0, |_| Ok(old_master())).unwrap();
    assert_eq!(store.read("first").unwrap(), "daily-secret");
    assert_eq!(store.read("second").unwrap(), "other-secret");
    assert_eq!(
        std::fs::read(folder.0.join("credentials.v1.enc")).unwrap(),
        old
    );
    store.remove("first").unwrap();
    store.remove("second").unwrap();
    let mut restarted = folder.store();
    restarted
        .migrate(&folder.0, |_| panic!("deleted keys must not be reimported"))
        .unwrap();
    assert!(!restarted.contains("first").unwrap());
}
#[test]
fn inaccessible_legacy_keys_do_not_block_saving_or_trigger_later_system_access() {
    let folder = Folder::new();
    legacy_file(&folder, "credentials.v1.enc", &[("old", "old-secret")]);
    let mut store = folder.store();
    let mut attempts = 0;
    store
        .migrate(&folder.0, |_| {
            attempts += 1;
            Err("denied".into())
        })
        .unwrap();
    assert_eq!(attempts, 1);
    assert!(store.contains("old").is_err());
    store.set("new", "saved-secret").unwrap();
    let mut restarted = folder.store();
    restarted
        .migrate(&folder.0, |_| panic!("no system access after saving"))
        .unwrap();
    assert_eq!(restarted.read("new").unwrap(), "saved-secret");
}
#[test]
fn corrupt_cipher_or_missing_master_never_overwrites_original_data() {
    let folder = Folder::new();
    let mut store = folder.store();
    store.set("first", "saved-secret").unwrap();
    let path = store.path();
    let mut damaged = std::fs::read(&path).unwrap();
    *damaged.last_mut().unwrap() ^= 1;
    std::fs::write(&path, &damaged).unwrap();
    assert!(Store::open(store.directory.clone()).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), damaged);
    std::fs::remove_file(store.key_path()).unwrap();
    assert!(Store::open(store.directory.clone()).is_err());
    assert!(!store.key_path().exists());
    assert_eq!(std::fs::read(path).unwrap(), damaged);
}
#[test]
fn failed_atomic_replace_does_not_report_success_or_change_memory() {
    let folder = Folder::new();
    let mut store = folder.store();
    store.set("first", "saved-secret").unwrap();
    let path = store.path();
    let backup = store.directory.join("original.enc");
    std::fs::rename(&path, &backup).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert!(store.set("first", "not-saved").is_err());
    assert_eq!(store.read("first").unwrap(), "saved-secret");
    std::fs::remove_dir(&path).unwrap();
    std::fs::rename(backup, path).unwrap();
    assert_eq!(folder.store().read("first").unwrap(), "saved-secret");
}
#[cfg(unix)]
#[test]
fn refuses_symlinked_key_files() {
    let folder = Folder::new();
    std::fs::create_dir_all(folder.0.join("credentials")).unwrap();
    let outside = folder.0.join("outside");
    std::fs::write(&outside, [4; 32]).unwrap();
    std::os::unix::fs::symlink(outside, folder.0.join("credentials/master.v1.key")).unwrap();
    assert!(Store::open(folder.0.join("credentials")).is_err());
}
#[test]
#[ignore = "manual cross-process persistence and macOS executable-signature change test; synthetic keys only"]
fn survives_process_restart_and_resigning() {
    const CHILD: &str = "VOXBRIDGE_PRIVATE_STORE_TEST";
    if let Some(path) = std::env::var_os(CHILD) {
        let store = Store::open(path.into()).unwrap();
        assert_eq!(
            store.read("synthetic-profile").unwrap(),
            "synthetic-not-an-api-key"
        );
        return;
    }
    let folder = Folder::new();
    let mut store = folder.store();
    store
        .set("synthetic-profile", "synthetic-not-an-api-key")
        .unwrap();
    let executable = folder.0.join("different-build");
    std::fs::copy(std::env::current_exe().unwrap(), &executable).unwrap();
    #[cfg(target_os = "macos")]
    assert!(std::process::Command::new("codesign")
        .args([
            "--force",
            "--sign",
            "-",
            "--identifier",
            "com.voxbridge.persistence-validation.updated"
        ])
        .arg(&executable)
        .status()
        .unwrap()
        .success());
    assert!(std::process::Command::new(executable)
        .args([
            "--exact",
            "credentials::store::tests::survives_process_restart_and_resigning",
            "--ignored"
        ])
        .env(CHILD, &store.directory)
        .status()
        .unwrap()
        .success());
}
