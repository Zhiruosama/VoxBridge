use super::{CaptureSource, CaptureState};
use crate::{asr::AsrProfile, providers::TranslationProfile};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

#[cfg(target_os = "macos")]
mod http;
#[cfg(target_os = "macos")]
mod realtime;
#[cfg(target_os = "macos")]
mod recovery;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningRequest {
    source: CaptureSource,
    session_id: String,
    asr_profile: AsrProfile,
    translation_profile: TranslationProfile,
    source_language: String,
    target_language: String,
    #[serde(skip)]
    generation: u32,
    #[serde(skip)]
    offset_ms: u64,
}

#[derive(Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ListeningEvent {
    Recovering {
        session_id: String,
        attempt: u32,
        delay_ms: u64,
        reason: String,
    },
    SourceChanged {
        session_id: String,
        generation: u32,
        source: CaptureSource,
    },
    Progress {
        session_id: String,
        generation: u32,
        phase: &'static str,
        sample_rate: u32,
        frames: u64,
        rms: f64,
        dropped_frames: u64,
        dropped_segments: u64,
        discontinuities: u64,
    },
    Transcript {
        session_id: String,
        generation: u32,
        segment_id: String,
        revision: u32,
        text: String,
        r#final: bool,
        start_ms: u64,
    },
    Translation {
        session_id: String,
        generation: u32,
        segment_id: String,
        revision: u32,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        source_text: Option<String>,
    },
}

#[cfg(target_os = "macos")]
fn segment_id(session: &str, generation: u32, sequence: u64) -> String {
    if generation == 0 {
        format!("{session}-{sequence}")
    } else {
        format!("{session}-r{generation}-{sequence}")
    }
}

#[cfg(target_os = "macos")]
struct QueuedSegment {
    audio: crate::audio_pipeline::AudioSegment,
    created: Instant,
}

#[cfg(target_os = "macos")]
fn send(
    channel: &tauri::ipc::Channel<ListeningEvent>,
    event: ListeningEvent,
) -> Result<(), String> {
    channel.send(event).map_err(|_| "字幕界面已关闭。".into())
}

#[cfg(target_os = "macos")]
struct SegmentProcessor<'a> {
    profile: &'a AsrProfile,
    key: &'a str,
    translation: &'a crate::providers::TranslationSession<'a>,
    session_id: &'a str,
    source: &'a str,
    target: &'a str,
    generation: u32,
    offset_ms: u64,
}

#[cfg(target_os = "macos")]
impl SegmentProcessor<'_> {
    async fn process(
        &self,
        segment: crate::audio_pipeline::AudioSegment,
        token: &tokio_util::sync::CancellationToken,
        mut emit: impl FnMut(ListeningEvent) -> Result<(), String>,
    ) -> Result<(), String> {
        let recognized = crate::asr::recognize(self.profile, &segment.wav, self.key, token).await?;
        if recognized.text.trim().is_empty() || token.is_cancelled() {
            return Ok(());
        }
        let segment_id = segment_id(self.session_id, self.generation, segment.sequence);
        emit(ListeningEvent::Transcript {
            session_id: self.session_id.into(),
            generation: self.generation,
            segment_id: segment_id.clone(),
            revision: 1,
            text: recognized.text.clone(),
            r#final: true,
            start_ms: self.offset_ms.saturating_add(segment.start_ms),
        })?;
        let text = self
            .translation
            .translate(&recognized.text, self.source, self.target, token)
            .await?;
        if !token.is_cancelled() {
            emit(ListeningEvent::Translation {
                session_id: self.session_id.into(),
                generation: self.generation,
                segment_id,
                revision: 1,
                text,
                source_text: None,
            })?;
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn capture_segments(
    source: CaptureSource,
    session_id: String,
    token: tokio_util::sync::CancellationToken,
    sender: tokio::sync::mpsc::Sender<QueuedSegment>,
    mut emit: impl FnMut(ListeningEvent) -> Result<(), String>,
    skipped: Arc<AtomicU64>,
    generation: u32,
) -> Result<(), String> {
    if token.is_cancelled() {
        return Ok(());
    }
    let (writer, mut reader, dropped) = crate::pcm::channel(192_000);
    let capture = match super::native::Capture::start(&source, writer, &token) {
        Ok(capture) => capture,
        Err(error) if error == "采集已停止。" => return Ok(()),
        Err(error) => return Err(error),
    };
    let mut pipeline = crate::audio_pipeline::AudioPipeline::new(capture.sample_rate)?;
    let mut meter = crate::pcm::Meter::default();
    let mut reported = Instant::now() - Duration::from_secs(1);
    let mut last_frame = Instant::now();
    let mut last_poll = std::time::SystemTime::now();
    loop {
        let now = std::time::SystemTime::now();
        if now.duration_since(last_poll).unwrap_or_default() > Duration::from_secs(5) {
            return Err("系统暂停后需要重新连接音频。".into());
        }
        last_poll = now;
        if capture.failed() {
            return Err("监听采集设备已断开或发生错误。".into());
        }
        if token.is_cancelled() || sender.is_closed() {
            return Ok(());
        }
        for _ in 0..48_000 {
            if token.is_cancelled() {
                return Ok(());
            }
            let Ok(frame) = reader.pop() else {
                break;
            };
            last_frame = Instant::now();
            meter.consume(frame);
            if let Some(audio) = pipeline.consume(frame) {
                let segment = QueuedSegment {
                    audio,
                    created: Instant::now(),
                };
                match sender.try_send(segment) {
                    Ok(()) => {}
                    Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                        skipped.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => return Ok(()),
                }
            }
        }
        if last_frame.elapsed() > Duration::from_secs(5) {
            return Err("监听采集回调中断。".into());
        }
        if reported.elapsed() >= Duration::from_millis(250) {
            if !capture.source_current(&source) {
                return Err("目标音频进程已退出或改变，请刷新后重新监听。".into());
            }
            emit(ListeningEvent::Progress {
                session_id: session_id.clone(),
                generation,
                phase: "running",
                sample_rate: capture.sample_rate,
                frames: meter.frames,
                rms: meter.rms(),
                dropped_frames: dropped.load(Ordering::Relaxed),
                dropped_segments: skipped.load(Ordering::Relaxed),
                discontinuities: pipeline.discontinuities,
            })?;
            reported = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[tauri::command]
pub async fn start_listening(
    request: ListeningRequest,
    on_event: tauri::ipc::Channel<ListeningEvent>,
    state: tauri::State<'_, CaptureState>,
    asr_state: tauri::State<'_, crate::asr::AsrState>,
    translations: tauri::State<'_, crate::providers::Requests>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if request.source.pid <= 0
            || request.source.pid as u32 == std::process::id()
            || request.source.bundle_id.len() > 512
            || request.source_language.is_empty()
            || request.target_language.is_empty()
            || request.source_language.len() > 100
            || request.target_language.len() > 100
        {
            return Err("监听进程或语言参数无效。".into());
        }
        crate::asr::endpoint(&request.asr_profile)?;
        let job = state.begin(&request.session_id)?;
        let asr_job = asr_state.begin(&request.session_id)?;
        let translation = tokio::select! { biased;
            _ = job.token.cancelled() => return Ok(()),
            _ = asr_job.token.cancelled() => return Ok(()),
            result = translations.listening_session(request.translation_profile.clone(), &request.session_id) => result?,
        };
        let key = tokio::select! { biased;
            _ = job.token.cancelled() => return Ok(()),
            _ = asr_job.token.cancelled() => return Ok(()),
            _ = translation.token.cancelled() => return Ok(()),
            result = crate::credentials::read_async(&request.asr_profile.id) => result?,
        };
        let result = recovery::run(
            &request,
            &on_event,
            &job.token,
            &asr_job.token,
            &translation,
            &key,
        )
        .await;
        job.token.cancel();
        let _ = send(
            &on_event,
            ListeningEvent::Progress {
                session_id: request.session_id,
                generation: 0,
                phase: if result.is_ok() { "stopped" } else { "failed" },
                sample_rate: 0,
                frames: 0,
                rms: 0.0,
                dropped_frames: 0,
                dropped_segments: 0,
                discontinuities: 0,
            },
        );
        result
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (request, on_event, state, asr_state, translations);
        Err("分段监听暂仅支持 Mac 桌面版。".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_events_match_frontend_contract() {
        let event = ListeningEvent::Transcript {
            session_id: "s".into(),
            generation: 0,
            segment_id: "s-1".into(),
            revision: 1,
            text: "hello".into(),
            r#final: true,
            start_ms: 100,
        };
        let value = serde_json::to_value(event).unwrap();
        assert_eq!(value["type"], "transcript");
        assert_eq!(value["sessionId"], "s");
        assert_eq!(value["final"], true);
        assert_eq!(value["startMs"], 100);
        let progress = serde_json::to_value(ListeningEvent::Progress {
            session_id: "s".into(),
            generation: 0,
            phase: "running",
            sample_rate: 48000,
            frames: 12000,
            rms: 0.1,
            dropped_frames: 0,
            dropped_segments: 0,
            discontinuities: 0,
        })
        .unwrap();
        assert_eq!(progress["frames"], 12000);
        assert_eq!(progress["sampleRate"], 48000);
    }

    #[cfg(target_os = "macos")]
    fn http_response(text: &str) -> (String, std::thread::JoinHandle<serde_json::Value>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let body =
            serde_json::json!({"choices":[{"finish_reason":"stop","message":{"content":text}}]})
                .to_string();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let end = loop {
                let mut buffer = [0; 4096];
                let count = stream.read(&mut buffer).unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&buffer[..count]);
                if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]);
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_lowercase()
                                .strip_prefix("content-length: ")
                                .and_then(|v| v.parse::<usize>().ok())
                        })
                        .unwrap();
                    if bytes.len() >= end + 4 + length {
                        break end;
                    }
                }
            };
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            serde_json::from_slice(&bytes[end + 4..]).unwrap()
        });
        (url, server)
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn pcm_segment_reaches_asr_then_corresponding_translation_without_real_credentials() {
        let (asr_url, asr_server) = http_response("Good morning");
        let (translation_url, translation_server) = http_response("早上好");
        let profile: AsrProfile = serde_json::from_value(serde_json::json!({"id":"test-asr","stage":"asr","adapter":"qwen_chat_asr","baseUrl":asr_url,"modelId":"test-model"})).unwrap();
        let translations = crate::providers::Requests::default();
        let translation_profile = serde_json::from_value(serde_json::json!({"id":"test-translation","stage":"translation","adapter":"openai_chat_completions","baseUrl":translation_url,"modelId":"test-model"})).unwrap();
        let translation = translations
            .reserve_listening(translation_profile, "session", "test-key".into())
            .unwrap();
        let processor = SegmentProcessor {
            profile: &profile,
            key: "test-key",
            translation: &translation,
            session_id: "session",
            source: "English",
            target: "Chinese",
            generation: 0,
            offset_ms: 0,
        };
        let mut pipeline = crate::audio_pipeline::AudioPipeline::new(48000).unwrap();
        let mut segment = None;
        for index in 0..96000 {
            let value = if (9600..48000).contains(&index) {
                0.2
            } else {
                0.0
            };
            if let Some(audio) = pipeline.consume(crate::pcm::Frame {
                index,
                samples: [value; 2],
            }) {
                segment = Some(audio);
            }
        }
        let mut events = Vec::new();
        processor
            .process(
                segment.unwrap(),
                &tokio_util::sync::CancellationToken::new(),
                |event| {
                    events.push(event);
                    Ok(())
                },
            )
            .await
            .unwrap();
        assert_eq!(events.len(), 2);
        let transcript = serde_json::to_value(&events[0]).unwrap();
        let translated = serde_json::to_value(&events[1]).unwrap();
        assert_eq!(transcript["type"], "transcript");
        assert_eq!(transcript["text"], "Good morning");
        assert_eq!(translated["type"], "translation");
        assert_eq!(translated["text"], "早上好");
        assert_eq!(transcript["segmentId"], translated["segmentId"]);
        let asr_body = asr_server.join().unwrap();
        assert!(asr_body
            .pointer("/messages/0/content/0/input_audio/data")
            .unwrap()
            .as_str()
            .unwrap()
            .starts_with("data:audio/wav;base64,"));
        assert_eq!(
            translation_server
                .join()
                .unwrap()
                .pointer("/messages/1/content")
                .unwrap(),
            "Good morning"
        );
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn cancelled_pipeline_emits_no_events_and_translation_slot_is_released() {
        let profile: AsrProfile = serde_json::from_value(serde_json::json!({"id":"test-asr","stage":"asr","adapter":"qwen_chat_asr","baseUrl":"http://127.0.0.1:1/v1","modelId":"test"})).unwrap();
        let translations = crate::providers::Requests::default();
        let translation_profile: TranslationProfile = serde_json::from_value(serde_json::json!({"id":"test-translation","stage":"translation","adapter":"openai_chat_completions","baseUrl":"http://127.0.0.1:1/v1","modelId":"test"})).unwrap();
        let translation = translations
            .reserve_listening(translation_profile.clone(), "session", "test-key".into())
            .unwrap();
        assert!(translations
            .reserve_listening(translation_profile.clone(), "session", "test-key".into())
            .is_err());
        let processor = SegmentProcessor {
            profile: &profile,
            key: "test-key",
            translation: &translation,
            session_id: "session",
            source: "English",
            target: "Chinese",
            generation: 0,
            offset_ms: 0,
        };
        let token = tokio_util::sync::CancellationToken::new();
        token.cancel();
        let audio = crate::audio_pipeline::AudioSegment {
            sequence: 1,
            start_ms: 0,
            wav: crate::audio_pipeline::encode_wav(&[0; 1600]),
        };
        let mut count = 0;
        assert!(processor
            .process(audio, &token, |_| {
                count += 1;
                Ok(())
            })
            .await
            .is_err());
        assert_eq!(count, 0);
        drop(translation);
        assert!(translations
            .reserve_listening(translation_profile, "session", "test-key".into())
            .is_ok());
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    #[ignore = "manual native capture of generated speech and paid ASR/translation; uses Keychain"]
    async fn live_synthetic_process_to_bilingual_subtitle() {
        crate::credentials::read_for_test("provider-deepseek-flash")
            .expect("explicit legacy fixture setup");

        let mut player = super::super::test_audio::SyntheticPlayer::start();
        let token = tokio_util::sync::CancellationToken::new();
        let _cancel_on_drop = token.clone().drop_guard();
        let worker_token = token.clone();
        let (sender, mut receiver) = tokio::sync::mpsc::channel(4);
        let (ready_sender, ready) = std::sync::mpsc::sync_channel(1);
        let source = player.source.clone();
        let initialized = Instant::now();
        let worker = std::thread::spawn(move || {
            let mut ready_sent = false;
            let mut received = 0;
            let result = capture_segments(
                source,
                "live-synthetic".into(),
                worker_token,
                sender,
                |event| {
                    if let ListeningEvent::Progress {
                        frames,
                        rms,
                        dropped_frames,
                        ..
                    } = event
                    {
                        received = frames;
                        assert_eq!(dropped_frames, 0);
                        if !ready_sent && frames > 0 {
                            assert_eq!(rms, 0.0, "fixture must start silent");
                            ready_sender.try_send(()).unwrap();
                            ready_sent = true;
                        }
                    }
                    Ok(())
                },
                Arc::new(AtomicU64::new(0)),
                0,
            );
            println!("SYNTHETIC_CAPTURE_METRICS: {received} frames delivered through production segment queue");
            result
        });
        // Always cancel and join before unwrapping so failures do not leave a tap running.
        let captured = async {
            ready
                .recv_timeout(Duration::from_secs(20))
                .map_err(|_| "capture not ready")?;
            println!(
                "SYNTHETIC_INITIALIZED: {} ms",
                initialized.elapsed().as_millis()
            );
            player.command("speech");
            tokio::time::timeout(Duration::from_secs(15), receiver.recv())
                .await
                .map_err(|_| "synthetic speech segment timed out")?
                .ok_or("capture worker exited")
        }
        .await;
        token.cancel();
        worker
            .join()
            .expect("native capture worker")
            .expect("production capture pipeline");
        drop(player);
        let segment = captured.expect("native synthetic capture").audio;
        let profile: AsrProfile = serde_json::from_value(serde_json::json!({"id":"provider-qwen-asr","stage":"asr","adapter":"qwen_chat_asr","baseUrl":"https://maas.qianwenaiapi.com/compatible-mode/v1","modelId":"qwen3-asr-flash"})).unwrap();
        let translations = crate::providers::Requests::default();
        let translation_profile = serde_json::from_value(serde_json::json!({"id":"provider-deepseek-flash","stage":"translation","adapter":"openai_chat_completions","baseUrl":"https://api.deepseek.com","modelId":"deepseek-flash","thinking":"disabled"})).unwrap();
        let translation = translations
            .listening_session(translation_profile, "live-synthetic")
            .await
            .unwrap();
        let key = crate::credentials::read_for_test("provider-qwen-asr").unwrap();
        let processor = SegmentProcessor {
            profile: &profile,
            key: &key,
            translation: &translation,
            session_id: "live-synthetic",
            source: "英语",
            target: "简体中文",
            generation: 0,
            offset_ms: 0,
        };
        let mut events = Vec::new();
        processor
            .process(
                segment,
                &tokio_util::sync::CancellationToken::new(),
                |event| {
                    events.push(event);
                    Ok(())
                },
            )
            .await
            .expect("live ASR and translation");
        assert_eq!(
            events.len(),
            2,
            "synthetic capture must produce transcript and translation"
        );
        let transcript = serde_json::to_value(&events[0]).unwrap();
        let translated = serde_json::to_value(&events[1]).unwrap();
        println!(
            "SYNTHETIC_SUBTITLE: {} | {}",
            transcript["text"], translated["text"]
        );
        assert!(
            transcript["text"]
                .as_str()
                .unwrap()
                .to_lowercase()
                .contains("meeting"),
            "synthetic meeting sentence must be recognized"
        );
        let chinese = translated["text"].as_str().unwrap();
        assert!(
            (chinese.contains("会议") || chinese.contains("开会"))
                && (chinese.contains('十') || chinese.contains("10")),
            "meeting time must be translated into Chinese"
        );
        assert_eq!(transcript["segmentId"], translated["segmentId"]);
        println!(
            "SYNTHETIC_CAPTURE_TO_SUBTITLE: passed; selected process only, no recording stored."
        );
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn full_queue_rejects_new_segments_without_blocking() {
        let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
        let segment = || QueuedSegment {
            audio: crate::audio_pipeline::AudioSegment {
                sequence: 1,
                start_ms: 0,
                wav: vec![],
            },
            created: Instant::now(),
        };
        sender.try_send(segment()).unwrap();
        assert!(matches!(
            sender.try_send(segment()),
            Err(tokio::sync::mpsc::error::TrySendError::Full(_))
        ));
        assert!(receiver.recv().await.is_some());
        drop(receiver);
        assert!(sender.is_closed());
    }
}
