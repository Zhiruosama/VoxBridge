use super::*;
fn master() -> Master {
    Master {
        id: format!("vault-{}", "1".repeat(32)),
        key: Zeroizing::new(vec![7; 32]),
    }
}
fn file() -> std::path::PathBuf {
    std::env::temp_dir()
        .join(format!(
            "vox-vault-test-{}",
            hex::encode(random(12).unwrap())
        ))
        .join("keys.enc")
}
#[test]
fn empty_and_runtime_paths_never_authorize_and_denial_is_once_per_session() {
    let v = Vault::default();
    let p = file();
    assert!(v.read("empty").is_err());
    assert!(v
        .unlock(&p, false, |_| panic!("empty must not authorize"))
        .is_err());
    v.set("manual", "test-secret").unwrap();
    assert_eq!(v.read("manual").unwrap(), "test-secret");
    assert_eq!(v.flags().unwrap(), (false, true));
    assert!(!p.exists());
    assert!(v.unlock(&p, true, |_| Err("denied".into())).is_err());
    assert!(v
        .unlock(&p, true, |_| panic!("must not request twice"))
        .is_err());
    assert_eq!(v.read("manual").unwrap(), "test-secret");
    v.remove("manual").unwrap();
    assert!(v.read("manual").is_err());
}
#[test]
fn encrypted_templates_unlock_once_preserve_manual_keys_and_restart_locked() {
    let p = file();
    let v = Vault::default();
    v.set("one", "persisted-secret").unwrap();
    v.unlock(&p, true, |_| Ok(master())).unwrap();
    v.save(&p, "one").unwrap();
    v.set("two", "another-secret").unwrap();
    v.unlock(&p, true, |_| panic!("second save must be memory-only"))
        .unwrap();
    v.save(&p, "two").unwrap();
    let bytes = std::fs::read(&p).unwrap();
    assert!(!bytes.windows(6).any(|w| w == b"secret"));
    let next = Vault::default();
    assert!(next.read("one").is_err());
    next.set("one", "manual-wins").unwrap();
    next.unlock(&p, false, |id| {
        assert_eq!(id, Some(master().id.as_str()));
        Ok(master())
    })
    .unwrap();
    assert_eq!(next.read("one").unwrap(), "manual-wins");
    assert_eq!(next.read("two").unwrap(), "another-secret");
    let mut damaged = bytes;
    *damaged.last_mut().unwrap() ^= 1;
    assert!(decrypt(&master(), &damaged).is_err());
    next.clear();
    assert!(next.read("two").is_err());
    let _ = std::fs::remove_dir_all(p.parent().unwrap());
}
#[test]
fn malformed_or_oversized_files_do_not_trigger_os_authentication() {
    let p = file();
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(&p, b"bad").unwrap();
    let v = Vault::default();
    assert!(v
        .unlock(&p, false, |_| panic!("invalid file must not authorize"))
        .is_err());
    assert!(v
        .unlock(&p, false, |_| panic!("invalid file cannot retry"))
        .is_err());
    let _ = std::fs::remove_dir_all(p.parent().unwrap());
}

#[test]
fn concurrent_unlock_attempt_cannot_prompt_twice_or_block_manual_use() {
    let v = std::sync::Arc::new(Vault::default());
    let p = file();
    v.set("manual", "runtime-only").unwrap();
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    let worker = v.clone();
    let first_path = p.clone();
    let thread = std::thread::spawn(move || {
        worker.unlock(&first_path, true, |_| {
            started_tx.send(()).unwrap();
            done_rx.recv().unwrap();
            Ok(master())
        })
    });
    started_rx.recv().unwrap();
    assert_eq!(v.read("manual").unwrap(), "runtime-only");
    assert!(v
        .unlock(&p, true, |_| panic!("concurrent authorization"))
        .is_err());
    done_tx.send(()).unwrap();
    thread.join().unwrap().unwrap();
    v.unlock(&p, true, |_| panic!("already unlocked")).unwrap();
}
