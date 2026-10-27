use super::*;
use tokio_util::sync::CancellationToken;
pub(super) async fn run(
    request: &ListeningRequest,
    on_event: &tauri::ipc::Channel<ListeningEvent>,
    token: &CancellationToken,
    asr_token: &CancellationToken,
    translation: &crate::providers::TranslationSession<'_>,
    key: &str,
) -> Result<(), String> {
    let skipped = Arc::new(AtomicU64::new(0));
    let (sender, mut receiver) = tokio::sync::mpsc::channel(4);
    send(
        on_event,
        ListeningEvent::Progress {
            session_id: request.session_id.clone(),
            generation: request.generation,
            phase: "starting",
            sample_rate: 0,
            frames: 0,
            rms: 0.0,
            audio_quality: None,
            dropped_frames: 0,
            dropped_segments: 0,
            discontinuities: 0,
        },
    )?;
    let channel = on_event.clone();
    let worker_token = token.clone();
    let id = request.session_id.clone();
    let capture_skipped = skipped.clone();
    let source = request.source.clone();
    let generation = request.generation;
    let worker = tauri::async_runtime::spawn_blocking(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            capture_segments(
                source,
                id,
                worker_token.clone(),
                sender,
                |event| send(&channel, event),
                capture_skipped,
                generation,
            )
        }))
        .unwrap_or_else(|_| Err("监听采集任务异常退出。".into()));
        worker_token.cancel();
        result
    });
    let processed = async {
            loop {
                let segment = tokio::select! {
                    biased;
                    _ = token.cancelled() => return Ok(()),
                    _ = asr_token.cancelled() => return Ok(()),
                    _ = translation.token.cancelled() => return Ok(()),
                    segment = receiver.recv() => match segment { Some(segment) => segment, None => return Ok(()) },
                };
                if segment.created.elapsed() > Duration::from_secs(20) { skipped.fetch_add(1, Ordering::Relaxed); continue; }
                let processor = SegmentProcessor { profile: &request.asr_profile, key,
                    translation, session_id: &request.session_id,
                    source: &request.source_language, target: &request.target_language, generation: request.generation, offset_ms: request.offset_ms };
                tokio::select! {
                    biased;
                    _ = token.cancelled() => return Ok(()),
                    _ = asr_token.cancelled() => return Ok(()),
                    _ = translation.token.cancelled() => return Ok(()),
                    result = processor.process(segment.audio, token, |event| send(on_event, event)) => result?,
                };
            }
        }.await;
    token.cancel();
    drop(receiver);
    let captured = worker
        .await
        .map_err(|_| "监听采集任务异常退出。".to_string())
        .and_then(|result| result);
    captured.and(processed)
}
