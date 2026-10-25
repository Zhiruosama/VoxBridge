use super::*;
use std::{fs, path::PathBuf};
struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "voxbridge-log-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        Self(p)
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn event() -> DiagnosticEvent {
    DiagnosticEvent {
        operation: "translate".into(),
        kind: "error".into(),
        correlation_id: Some("11111111-2222-4333-8444-555555555555:2".into()),
        reason: Some("auth".into()),
        duration_ms: Some(125),
        ..Default::default()
    }
}
fn record(index: u64) -> Record {
    Record {
        schema_version: 1,
        time_unix_ms: index,
        uptime_ms: index,
        run_id: "test-run".into(),
        version: "test",
        platform: "test",
        architecture: "test",
        source: "main",
        event: event(),
    }
}
#[test]
fn rejects_content_credentials_urls_and_arbitrary_metadata() {
    assert!(validate(&event()));
    for key in [
        "message",
        "apiKey",
        "text",
        "url",
        "stack",
        "settings",
        "deviceName",
    ] {
        let mut value = serde_json::to_value(event()).unwrap();
        value[key] = serde_json::json!("private-user-content");
        assert!(serde_json::from_value::<DiagnosticEvent>(value).is_err());
    }
    let mut e = event();
    e.operation = "https://private.example/api-key".into();
    assert!(!validate(&e));
    e = event();
    e.adapter = Some("private-provider-name-or-key".into());
    assert!(!validate(&e));
    e = event();
    e.reason = Some("private-provider-response".into());
    assert!(!validate(&e));
    e = event();
    e.phase = Some("private-chat-text".into());
    assert!(!validate(&e));
    e = event();
    e.correlation_id = Some("secret-not-a-request-uuid".into());
    assert!(!validate(&e));
    e = event();
    e.count = Some(u32::MAX);
    assert!(!validate(&e));
}
#[test]
fn rotation_and_exports_are_bounded_and_do_not_include_neighbor_files() {
    let dir = Directory::new();
    let mut w = writer::Writer::open(&dir.0).unwrap();
    fs::write(dir.0.join("credentials.json"), "never-export-this-secret").unwrap();
    let size = serde_json::to_vec(&record(12345)).unwrap().len() as u64 + 1;
    for i in 0..(writer::LIMIT * 4 / size) {
        w.append(&record(i)).unwrap();
    }
    let exported = w.export(9).unwrap();
    for name in [
        "diagnostics.jsonl",
        "diagnostics.1.jsonl",
        "diagnostics.2.jsonl",
    ] {
        assert!(fs::metadata(dir.0.join(name)).unwrap().len() <= writer::LIMIT);
    }
    assert!(!dir.0.join("diagnostics.3.jsonl").exists());
    let path = exported.join("VoxBridge-diagnostics.jsonl");
    let content = fs::read_to_string(&path).unwrap();
    assert!(!content.contains("never-export-this-secret"));
    assert!(content.len() as u64 <= writer::LIMIT * 3 + 512);
    let entries: Vec<serde_json::Value> = content
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(entries[0]["droppedEvents"], 9);
    let times: Vec<u64> = entries[1..]
        .iter()
        .map(|v| v["timeUnixMs"].as_u64().unwrap())
        .collect();
    assert!(times.windows(2).all(|v| v[0] < v[1]));
    assert!(times[0] > 0);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&dir.0).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
#[test]
#[cfg(unix)]
fn refuses_symlinked_log_files_and_export_folders() {
    use std::os::unix::fs::symlink;
    let dir = Directory::new();
    fs::create_dir_all(&dir.0).unwrap();
    let outside = dir.0.join("private.txt");
    fs::write(&outside, "keep").unwrap();
    symlink(&outside, dir.0.join("diagnostics.jsonl")).unwrap();
    assert!(writer::Writer::open(&dir.0).is_err());
    assert_eq!(fs::read_to_string(&outside).unwrap(), "keep");
    fs::remove_file(dir.0.join("diagnostics.jsonl")).unwrap();
    let mut w = writer::Writer::open(&dir.0).unwrap();
    let neighbor = dir.0.join("neighbor");
    fs::create_dir(&neighbor).unwrap();
    symlink(&neighbor, dir.0.join("export")).unwrap();
    assert!(w.export(0).is_err());
    fs::remove_file(dir.0.join("export")).unwrap();
    symlink(&outside, dir.0.join("diagnostics.1.jsonl")).unwrap();
    assert!(w.export(0).is_err());
    assert_eq!(fs::read_to_string(&outside).unwrap(), "keep");
}
