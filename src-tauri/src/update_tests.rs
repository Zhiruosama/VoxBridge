#[test]
#[ignore = "manual: verifies local updater artifact against embedded public key; no network or installation"]
fn local_updater_signature_rejects_modified_package() {
    use base64::Engine;
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let decode = |value: &str| {
        String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(value.trim())
                .unwrap(),
        )
        .unwrap()
    };
    let key = minisign_verify::PublicKey::decode(&decode(
        config["plugins"]["updater"]["pubkey"].as_str().unwrap(),
    ))
    .unwrap();
    let directory =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/debug/bundle/nsis");
    let name = format!("VoxBridge_{}_x64-setup.exe", env!("CARGO_PKG_VERSION"));
    let mut bytes = std::fs::read(directory.join(&name)).unwrap();
    let signature =
        decode(&std::fs::read_to_string(directory.join(format!("{name}.sig"))).unwrap());
    assert!(signature.contains(&format!("version:{}", env!("CARGO_PKG_VERSION"))));
    let signature = minisign_verify::Signature::decode(&signature).unwrap();
    key.verify(&bytes, &signature, true).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    assert!(key.verify(&bytes, &signature, true).is_err());
    println!("Updater package signature and signed version validated; corrupted package rejected.");
}

#[test]
#[ignore = "manual CI artifact verification; requires downloaded release-combined artifacts, no installation"]
fn ci_release_signatures_match_embedded_key() {
    use base64::Engine;
    let decode = |value: &str| {
        String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(value.trim())
                .unwrap(),
        )
        .unwrap()
    };
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let key = minisign_verify::PublicKey::decode(&decode(
        config["plugins"]["updater"]["pubkey"].as_str().unwrap(),
    ))
    .unwrap();
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../native/windows/.build/release-verified");
    let mut checked = 0;
    for entry in std::fs::read_dir(&directory).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|extension| extension != "sig") {
            continue;
        }
        let signed = decode(&std::fs::read_to_string(&path).unwrap());
        assert!(signed.contains(&format!("version:{}", env!("CARGO_PKG_VERSION"))));
        let signature = minisign_verify::Signature::decode(&signed).unwrap();
        let payload = path.with_extension("");
        key.verify(&std::fs::read(&payload).unwrap(), &signature, true)
            .unwrap();
        checked += 1;
        println!(
            "CI updater verified: {}",
            payload.file_name().unwrap().to_string_lossy()
        );
    }
    assert!(checked >= 2, "expected signed Windows and Mac artifacts");
}
