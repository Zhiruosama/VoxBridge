//! Local, bounded diagnostics. Never accept arbitrary messages, request bodies or credentials.
mod writer;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, SyncSender},
        Arc, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const OPERATIONS: &[&str] = &[
    "runtime",
    "frontend",
    "queue",
    "detect_text_language",
    "credential_status",
    "set_credential",
    "remove_credential",
    "translate",
    "cancel_translation",
    "list_outputs",
    "test_tone",
    "stop_tone",
    "speak",
    "stop_speech",
    "list_capture_sources",
    "capture_diagnostic",
    "stop_capture",
    "finish_listening",
    "transcribe_wav",
    "stop_asr",
    "start_listening",
    "show_overlay",
    "hide_overlay",
    "focus_main",
    "stop_overlay_listening",
    "set_speech_monitoring",
    "open_virtual_mic_installer",
    "list_inputs",
    "start_voice_input",
    "finish_voice_input",
    "cancel_voice_input",
    "prepare_speech",
    "play_prepared_speech",
    "discard_prepared_speech",
];
const KINDS: &[&str] = &[
    "startup", "shutdown", "panic", "start", "finish", "error", "state", "recovery",
];
const PHASES: &[&str] = &[
    "queued",
    "preparing",
    "detecting",
    "translating",
    "synthesizing",
    "ready",
    "playing",
    "stopping",
    "failed",
    "idle",
    "paused",
    "running",
    "completed",
    "cancelled",
    "unhandled_error",
    "unhandled_rejection",
    "page_workspace",
    "page_settings",
    "page_diagnostics",
    "settings_saved",
    "settings_load_failed",
    "settings_save_failed",
    "theme_light",
    "theme_dark",
    "recognition_metrics",
    "translation_metrics",
    "source_changed",
    "waitingDevice",
    "decoding",
    "stopped",
    "monitorUnavailable",
];
const REASONS: &[&str] = &[
    "auth",
    "rate_limit",
    "quota",
    "timeout",
    "network",
    "permission",
    "device",
    "invalid_response",
    "configuration",
    "cancelled",
    "unknown",
];

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticEvent {
    pub operation: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adapter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queued: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inflight: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay_ms: Option<u64>,
}
fn identifier(value: &str) -> bool {
    let mut parts = value.split(':');
    let uuid = parts.next().unwrap_or_default().as_bytes();
    uuid.len() == 36
        && uuid.iter().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                *b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
        && parts
            .next()
            .is_none_or(|s| !s.is_empty() && s.len() <= 6 && s.bytes().all(|b| b.is_ascii_digit()))
        && parts.next().is_none()
}
fn validate(event: &DiagnosticEvent) -> bool {
    OPERATIONS.contains(&event.operation.as_str())
        && KINDS.contains(&event.kind.as_str())
        && event.correlation_id.as_deref().is_none_or(identifier)
        && event.trace_id.as_deref().is_none_or(identifier)
        && event.phase.as_deref().is_none_or(|v| PHASES.contains(&v))
        && event.adapter.as_deref().is_none_or(|v| {
            [
                "openai_chat_completions",
                "minimax_tts_ws",
                "openai_audio_speech",
                "qwen_chat_asr",
                "qwen_dashscope_asr",
                "pending_asr",
            ]
            .contains(&v)
        })
        && event.reason.as_deref().is_none_or(|v| REASONS.contains(&v))
        && event.duration_ms.is_none_or(|v| v <= 86_400_000)
        && event.count.is_none_or(|v| v <= 1_000_000_000)
        && event.failed_count.is_none_or(|v| v <= 1_000_000_000)
        && event.queued.is_none_or(|v| v <= 512)
        && event.inflight.is_none_or(|v| v <= 16)
        && event.attempt.is_none_or(|v| v <= 1_000_000_000)
        && event.delay_ms.is_none_or(|v| v <= 60_000)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    schema_version: u8,
    time_unix_ms: u64,
    uptime_ms: u64,
    run_id: String,
    version: &'static str,
    platform: &'static str,
    architecture: &'static str,
    source: &'static str,
    #[serde(flatten)]
    event: DiagnosticEvent,
}
enum Message {
    Event(Record),
    Flush(mpsc::Sender<Result<(), String>>),
    Export(mpsc::Sender<Result<PathBuf, String>>),
}
struct Sink {
    directory: PathBuf,
    sender: SyncSender<Message>,
    dropped: Arc<AtomicU64>,
    started: Instant,
    run_id: String,
}
static SINK: OnceLock<Sink> = OnceLock::new();
fn enqueue(event: DiagnosticEvent, source: &'static str) {
    let Some(sink) = SINK.get() else {
        return;
    };
    if !validate(&event) {
        return;
    }
    let record = Record {
        schema_version: 1,
        time_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(u64::MAX as u128) as u64,
        uptime_ms: sink.started.elapsed().as_millis().min(u64::MAX as u128) as u64,
        run_id: sink.run_id.clone(),
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        source,
        event,
    };
    if sink.sender.try_send(Message::Event(record)).is_err() {
        sink.dropped.fetch_add(1, Ordering::Relaxed);
    }
}
pub fn record(event: DiagnosticEvent) {
    enqueue(event, "native");
}
pub fn lifecycle(kind: &str) {
    record(DiagnosticEvent {
        operation: "runtime".into(),
        kind: kind.into(),
        ..Default::default()
    });
}
pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    use ring::rand::SecureRandom;
    let directory = app
        .path()
        .app_log_dir()
        .map_err(|_| "无法定位诊断日志目录。")?
        .join("diagnostics");
    let mut writer = writer::Writer::open(&directory)?;
    let (sender, receiver) = mpsc::sync_channel(512);
    let dropped = Arc::new(AtomicU64::new(0));
    let counter = dropped.clone();
    let mut random = [0; 16];
    ring::rand::SystemRandom::new()
        .fill(&mut random)
        .map_err(|_| "无法初始化诊断日志。")?;
    std::thread::Builder::new()
        .name("diagnostics-writer".into())
        .spawn(move || {
            while let Ok(message) = receiver.recv() {
                match message {
                    Message::Event(record) => {
                        if writer.append(&record).is_err() {
                            counter.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    Message::Flush(reply) => {
                        let _ = reply.send(writer.flush());
                    }
                    Message::Export(reply) => {
                        let _ = reply.send(writer.export(counter.load(Ordering::Relaxed)));
                    }
                }
            }
        })
        .map_err(|_| "无法启动诊断日志。")?;
    SINK.set(Sink {
        directory,
        sender,
        dropped,
        started: Instant::now(),
        run_id: hex::encode(random),
    })
    .map_err(|_| "诊断日志已经初始化。")?;
    lifecycle("startup");
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        lifecycle("panic");
        previous(info);
    }));
    Ok(())
}
pub fn flush() -> Result<(), String> {
    let sink = SINK.get().ok_or("诊断日志暂不可用。")?;
    let (sender, receiver) = mpsc::channel();
    sink.sender
        .try_send(Message::Flush(sender))
        .map_err(|_| "诊断日志繁忙，请稍后重试。")?;
    receiver
        .recv_timeout(Duration::from_millis(800))
        .map_err(|_| "诊断日志刷新超时。")?
}
fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("此操作仅限主窗口。".into());
    }
    Ok(())
}
#[tauri::command]
pub fn record_diagnostic(
    window: tauri::WebviewWindow,
    event: DiagnosticEvent,
) -> Result<(), String> {
    let source = match window.label() {
        "main" => "main",
        "subtitle" => "subtitle",
        _ => return Err("诊断日志来源无效。".into()),
    };
    if !validate(&event) {
        return Err("诊断日志字段无效。".into());
    }
    enqueue(event, source);
    Ok(())
}
fn open_directory(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("/usr/bin/open");
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer.exe");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = std::process::Command::new("xdg-open");
    let status = command
        .arg(path)
        .status()
        .map_err(|_| "无法打开日志文件夹。")?;
    if !status.success() {
        return Err("无法打开日志文件夹。".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn open_diagnostics_folder(window: tauri::WebviewWindow) -> Result<(), String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(|| {
        open_directory(&SINK.get().ok_or("诊断日志暂不可用。")?.directory)
    })
    .await
    .map_err(|_| "无法打开日志文件夹。".to_string())?
}
#[tauri::command]
pub async fn export_diagnostics(window: tauri::WebviewWindow) -> Result<(), String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(|| {
        let sink = SINK.get().ok_or("诊断日志暂不可用。")?;
        let (sender, receiver) = mpsc::channel();
        sink.sender
            .try_send(Message::Export(sender))
            .map_err(|_| "诊断日志繁忙，请稍后重试。")?;
        let export = receiver
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "无法导出诊断日志。")??;
        open_directory(&export)
    })
    .await
    .map_err(|_| "无法导出诊断日志。".to_string())?
}
#[cfg(test)]
mod tests;
