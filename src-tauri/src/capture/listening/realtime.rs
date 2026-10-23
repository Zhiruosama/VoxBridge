use super::*;
use crate::asr::realtime::Sentence;
use tokio::sync::{mpsc, oneshot};
mod chunks;
mod translations;
use tokio_util::sync::CancellationToken;

fn capture_pcm(
    source: CaptureSource,
    session_id: String,
    token: CancellationToken,
    sender: mpsc::Sender<Vec<u8>>,
    channel: tauri::ipc::Channel<ListeningEvent>,
    skipped: Arc<AtomicU64>,
    generation: u32,
) -> Result<(), String> {
    if token.is_cancelled() {
        return Ok(());
    }
    let (writer, mut reader, dropped) = crate::pcm::channel(192_000);
    let capture = match super::super::native::Capture::start(&source, writer, &token) {
        Ok(capture) => capture,
        Err(error) if error == "采集已停止。" => return Ok(()),
        Err(error) => return Err(error),
    };
    if !(8_000..=192_000).contains(&capture.sample_rate) {
        return Err("采集采样率不受支持。".into());
    }
    let mut resampler = crate::audio_pipeline::Resampler::new(capture.sample_rate);
    let mut meter = crate::pcm::Meter::default();
    let mut block = Vec::with_capacity(640);
    let mut reported = Instant::now() - Duration::from_secs(1);
    let mut last_frame = Instant::now();
    let mut last_poll = std::time::SystemTime::now();
    loop {
        let now = std::time::SystemTime::now();
        if now.duration_since(last_poll).unwrap_or_default() > Duration::from_secs(5) {
            return Err("系统暂停后需要重新连接音频。".into());
        }
        last_poll = now;
        if token.is_cancelled() || sender.is_closed() {
            return Ok(());
        }
        if capture.failed() {
            return Err("监听采集设备已断开或发生错误。".into());
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
            if meter.gaps > 0 || dropped.load(Ordering::Relaxed) > 0 {
                return Err("音频采集发生中断，请重新开始监听。".into());
            }
            resampler.push((frame.samples[0] + frame.samples[1]) * 0.5, |sample| {
                block.extend_from_slice(&((sample * 32767.0).round() as i16).to_le_bytes());
            });
            if block.len() >= 640 {
                sender
                    .try_send(std::mem::replace(&mut block, Vec::with_capacity(640)))
                    .map_err(|_| "实时识别发送积压或已断开，请重新监听。".to_string())?;
            }
        }
        if last_frame.elapsed() > Duration::from_secs(5) {
            return Err("监听采集回调中断。".into());
        }
        if reported.elapsed() >= Duration::from_millis(250) {
            if !capture.source_current(&source) {
                return Err("目标音频进程已退出或改变，请刷新后重新监听。".into());
            }
            send(
                &channel,
                ListeningEvent::Progress {
                    session_id: session_id.clone(),
                    generation,
                    phase: "running",
                    sample_rate: capture.sample_rate,
                    frames: meter.frames,
                    rms: meter.rms(),
                    dropped_frames: dropped.load(Ordering::Relaxed),
                    dropped_segments: skipped.load(Ordering::Relaxed),
                    discontinuities: 0,
                },
            )?;
            reported = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

pub(super) async fn run(
    request: &ListeningRequest,
    channel: &tauri::ipc::Channel<ListeningEvent>,
    token: &CancellationToken,
    asr_token: &CancellationToken,
    translation: &crate::providers::TranslationSession<'_>,
    key: &str,
) -> Result<(), String> {
    send(
        channel,
        ListeningEvent::Progress {
            session_id: request.session_id.clone(),
            generation: request.generation,
            phase: "starting",
            sample_rate: 0,
            frames: 0,
            rms: 0.0,
            dropped_frames: 0,
            dropped_segments: 0,
            discontinuities: 0,
        },
    )?;
    let (audio_tx, audio_rx) = mpsc::channel(100);
    let (final_tx, final_rx) = mpsc::channel::<Sentence>(32);
    let (source_tx, mut source_rx) = mpsc::channel(64);
    let (ready_tx, ready_rx) = oneshot::channel();
    let skipped = Arc::new(AtomicU64::new(0));
    let source = request.source.clone();
    let generation = request.generation;
    let id = request.session_id.clone();
    let capture_token = token.clone();
    let capture_channel = channel.clone();
    let capture_skipped = skipped.clone();
    let captured = async move {
        tokio::select! { biased;
            _ = capture_token.cancelled() => return Ok(()),
            ready = ready_rx => if ready.is_err() { return Ok(()); },
        }
        let cancel = capture_token.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                capture_pcm(
                    source,
                    id,
                    capture_token,
                    audio_tx,
                    capture_channel,
                    capture_skipped,
                    generation,
                )
            }))
            .unwrap_or_else(|_| Err("监听采集任务异常退出。".into()));
            cancel.cancel();
            result
        })
        .await
        .map_err(|_| "监听采集任务异常退出。".to_string())
        .and_then(|result| result);
        token.cancel();
        result
    };
    let recognized = async {
        let result = crate::asr::realtime::recognize_stream(
            &request.asr_profile,
            key,
            token,
            audio_rx,
            ready_tx,
            |sentence| {
                if token.is_cancelled() {
                    return Ok(());
                }
                source_tx
                    .try_send(sentence)
                    .map_err(|_| "识别结果处理积压，请重新监听。")?;
                Ok(())
            },
        )
        .await;
        token.cancel();
        result
    };
    let segmented = async {
        let mut chunks = chunks::Chunks::default();
        let started = Instant::now();
        let mut tick = tokio::time::interval(Duration::from_millis(200));
        let result: Result<(), String> = async {
            loop {
                let output = tokio::select! { biased;
                    _ = token.cancelled() => return Ok(()),
                    sentence = source_rx.recv() => match sentence {
                        Some(sentence) => chunks.push(sentence, started.elapsed().as_millis() as u64),
                        None => return Ok(()),
                    },
                    _ = tick.tick() => chunks.flush(started.elapsed().as_millis() as u64),
                };
                for sentence in output {
                    send(
                        channel,
                        ListeningEvent::Transcript {
                            session_id: request.session_id.clone(),
                            generation: request.generation,
                            segment_id: segment_id(
                                &request.session_id,
                                request.generation,
                                sentence.id,
                            ),
                            revision: sentence.revision,
                            text: sentence.text.clone(),
                            r#final: sentence.final_text,
                            start_ms: request.offset_ms.saturating_add(sentence.start_ms),
                        },
                    )?;
                    if sentence.final_text && !sentence.text.trim().is_empty() {
                        match final_tx.try_send(sentence) {
                            Ok(()) => {}
                            Err(mpsc::error::TrySendError::Full(_)) => {
                                skipped.fetch_add(1, Ordering::Relaxed);
                                return Err("字幕翻译积压，请稍后重新监听。".into());
                            }
                            Err(mpsc::error::TrySendError::Closed(_)) => {
                                return Err("字幕翻译任务已结束。".into())
                            }
                        }
                    }
                }

            }
        }.await;
        token.cancel();
        result
    };
    let translated = async {
        let result = translations::translate_chunks(
            token,
            final_rx,
            |sentence| async move {
                translation
                    .translate(
                        &sentence.text,
                        &request.source_language,
                        &request.target_language,
                        token,
                    )
                    .await
            },
            |sentence, text| {
                let text = match text {
                    Ok(text) => text,
                    Err(_) => {
                        return send(
                            channel,
                            ListeningEvent::TranslationError {
                                session_id: request.session_id.clone(),
                                generation: request.generation,
                                segment_id: segment_id(
                                    &request.session_id,
                                    request.generation,
                                    sentence.id,
                                ),
                                revision: sentence.revision,
                            },
                        )
                    }
                };
                send(
                    channel,
                    ListeningEvent::Translation {
                        session_id: request.session_id.clone(),
                        generation: request.generation,
                        segment_id: segment_id(
                            &request.session_id,
                            request.generation,
                            sentence.id,
                        ),
                        revision: sentence.revision,
                        source_text: None,
                        text,
                    },
                )
            },
        )
        .await;
        token.cancel();
        result
    };
    let stopped = async {
        tokio::select! {
            _ = token.cancelled() => {}, _ = asr_token.cancelled() => {}, _ = translation.token.cancelled() => {},
        };
        token.cancel();
    };
    let (capture, recognition, segmentation, translation, ()) =
        tokio::join!(captured, recognized, segmented, translated, stopped);
    capture.and(recognition).and(segmentation).and(translation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[tokio::test]
    #[ignore = "manual: native generated process capture and real Qwen/DeepSeek services"]
    async fn live_realtime_capture_to_bilingual_subtitles() {
        crate::credentials::read_for_test("provider-deepseek-flash")
            .expect("explicit legacy fixture setup");

        let mut player = crate::capture::test_audio::SyntheticPlayer::start();
        let request: ListeningRequest = serde_json::from_value(json!({
            "source": player.source, "sessionId":"live-realtime",
            "asrProfile":{"id":"provider-qwen-asr","stage":"asr","adapter":"qwen_dashscope_asr","baseUrl":"wss://maas.qianwenaiapi.com/api-ws/v1/inference","modelId":"qwen-audio-3.0-asr-flash-streaming"},
            "translationProfile":{"id":"provider-deepseek-flash","stage":"translation","adapter":"openai_chat_completions","baseUrl":"https://api.deepseek.com","modelId":"deepseek-flash","thinking":"disabled"},
            "sourceLanguage":"英语","targetLanguage":"简体中文"
        })).unwrap();
        let token = CancellationToken::new();
        let _guard = token.clone().drop_guard();
        let observed = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
        let events = observed.clone();
        let (ready_tx, ready_rx) = oneshot::channel();
        let ready_tx = std::sync::Mutex::new(Some(ready_tx));
        let started = Instant::now();
        let stop = token.clone();
        let channel = tauri::ipc::Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(body) = body {
                let event: Value = serde_json::from_str(&body).unwrap();
                if event["type"] == "progress" && event["frames"].as_u64().unwrap_or(0) > 0 {
                    if let Some(ready) = ready_tx.lock().unwrap().take() {
                        let _ = ready.send(());
                    }
                }
                if event["type"] == "transcript" {
                    println!(
                        "REALTIME_TRANSCRIPT: final={} at {} ms",
                        event["final"],
                        started.elapsed().as_millis()
                    );
                }
                if event["type"] == "translation" {
                    stop.cancel();
                }
                events.lock().unwrap().push(event);
            }
            Ok(())
        });
        let translations = crate::providers::Requests::default();
        let translation = translations
            .listening_session(request.translation_profile.clone(), &request.session_id)
            .await
            .unwrap();
        let key = crate::credentials::read_for_test("provider-qwen-asr").unwrap();
        let asr_token = CancellationToken::new();
        let listening = run(&request, &channel, &token, &asr_token, &translation, &key);
        let play = async {
            tokio::time::timeout(Duration::from_secs(20), ready_rx)
                .await
                .unwrap()
                .unwrap();
            player.command("speech");
            tokio::select! {
                _ = token.cancelled() => {},
                _ = tokio::time::sleep(Duration::from_secs(30)) => {token.cancel();},
            }
        };
        let (result, ()) = tokio::join!(listening, play);
        result.unwrap();
        let events = observed.lock().unwrap();
        let final_text = events
            .iter()
            .find(|event| event["type"] == "transcript" && event["final"] == true)
            .expect("final transcript");
        assert!(final_text["text"]
            .as_str()
            .unwrap()
            .to_lowercase()
            .contains("meeting"));
        let translated = events
            .iter()
            .find(|event| event["type"] == "translation")
            .expect("translation");
        let text = translated["text"].as_str().unwrap();
        assert!(text.contains("会议") || text.contains("开会"));
        assert_eq!(translated["segmentId"], final_text["segmentId"]);
        assert_eq!(translated["revision"], final_text["revision"]);
        assert!(events
            .iter()
            .any(|event| event["type"] == "transcript" && event["final"] == false));
        println!(
            "REALTIME_CAPTURE_TRANSLATION: passed, elapsed={} ms",
            started.elapsed().as_millis()
        );
    }
}

#[cfg(test)]
mod duplex_tests;
