use super::*;
use tokio::sync::mpsc;

const RATE: u32 = 32_000;

pub(super) fn validate_metadata(value: &Value) -> Result<(), String> {
    for (field, expected) in [
        ("audio_sample_rate", json!(RATE)),
        ("audio_channel", json!(1)),
        ("audio_format", json!("pcm")),
    ] {
        if value
            .get("extra_info")
            .and_then(|info| info.get(field))
            .is_some_and(|actual| *actual != expected)
        {
            return Err("语音服务返回的 PCM 格式与请求不一致。".into());
        }
    }
    Ok(())
}

#[derive(Default)]
struct PcmDecoder {
    carry: Option<u8>,
    samples: usize,
}
impl PcmDecoder {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<f32>, String> {
        let mut samples = Vec::with_capacity(bytes.len().div_ceil(2));
        for byte in bytes {
            if let Some(low) = self.carry.take() {
                self.samples += 1;
                if self.samples > RATE as usize * 120 {
                    return Err("语音超过 120 秒限制。".into());
                }
                samples.push(f32::from(i16::from_le_bytes([low, *byte])) / 32768.0);
            } else {
                self.carry = Some(*byte);
            }
        }
        Ok(samples)
    }
    fn finish(&self) -> Result<(), String> {
        if self.carry.is_some() {
            Err("语音 PCM 样本不完整。".into())
        } else if self.samples == 0 {
            Err("服务返回了空音频。".into())
        } else {
            Ok(())
        }
    }
}

async fn synthesize_stream(
    profile: &SpeechProfile,
    url: url::Url,
    text: &str,
    key: &str,
    token: &CancellationToken,
    sender: &mpsc::Sender<Vec<u8>>,
) -> Result<(), String> {
    tokio::select! {
        biased;
        _ = token.cancelled() => Err(STOPPED.into()),
        result = tokio::time::timeout(Duration::from_secs(150), synthesize_response(profile, url, text, key, Some(sender))) => {
            result.map_err(|_| "语音合成超时，请重试。".to_string())??;
            Ok(())
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn play_stream(
    device: String,
    monitor_device: Option<String>,
    monitoring: Arc<AtomicBool>,
    token: CancellationToken,
    ready: tokio::sync::oneshot::Sender<Result<(), String>>,
    mut audio: mpsc::Receiver<Vec<u8>>,
    channel: tauri::ipc::Channel<SpeechProgress>,
    request_id: String,
) -> Result<(), String> {
    let failed = Arc::new(AtomicBool::new(false));
    let stream = match open_output(&device, failed.clone()) {
        Ok(stream) => {
            let _ = ready.send(Ok(()));
            stream
        }
        Err(error) => {
            let _ = ready.send(Err(error.clone()));
            return Err(error);
        }
    };
    let sink = Player::connect_new(stream.mixer());
    let mut monitor = super::monitor::LocalMonitor::new(monitor_device, monitoring);
    let mut decoder = PcmDecoder::default();
    let mut finished = false;
    let mut playing = false;
    let started = Instant::now();
    loop {
        // Cancellation drops both the player and output stream, discarding queued audio.
        if token.is_cancelled() {
            sink.stop();
            return Err(STOPPED.into());
        }
        if failed.load(Ordering::SeqCst) {
            sink.stop();
            return Err("播放设备已断开或发生错误。".into());
        }
        if started.elapsed() > Duration::from_secs(155) {
            sink.stop();
            return Err("语音播放超时。".into());
        }
        monitor.tick(&channel, &request_id);
        // Keep at most three 100 ms sources in Rodio, independently of network chunk sizes.
        if !finished && sink.len() < 3 {
            match audio.try_recv() {
                Ok(bytes) => {
                    let samples = decoder.push(&bytes)?;
                    if !samples.is_empty() {
                        monitor.samples(&samples, RATE);
                        sink.append(SamplesBuffer::new(
                            std::num::NonZeroU16::new(1).unwrap(),
                            std::num::NonZeroU32::new(RATE).unwrap(),
                            samples,
                        ));
                        if !playing {
                            progress(&channel, &request_id, "playing");
                            playing = true;
                        }
                    }
                }
                Err(mpsc::error::TryRecvError::Disconnected) => {
                    decoder.finish()?;
                    finished = true;
                }
                Err(mpsc::error::TryRecvError::Empty) => {}
            }
        }
        if finished && sink.empty() && monitor.drained() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn speak_streaming(
    profile: SpeechProfile,
    url: url::Url,
    text: String,
    device: String,
    monitor_device: Option<String>,
    key: String,
    job: Job,
    permit: tokio::sync::OwnedSemaphorePermit,
    channel: tauri::ipc::Channel<SpeechProgress>,
) -> Result<(), String> {
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let (sender, receiver) = mpsc::channel(8);
    let worker_token = job.token.clone();
    let monitoring = job.monitor.clone();
    let worker_channel = channel.clone();
    let id = job.id.clone();
    let worker = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let result = play_stream(
            device,
            monitor_device,
            monitoring,
            worker_token.clone(),
            ready_tx,
            receiver,
            worker_channel,
            id,
        );
        if result.is_err() {
            worker_token.cancel();
        }
        result
    });
    let synthesized = async {
        ready_rx
            .await
            .map_err(|_| "音频任务初始化失败。".to_string())??;
        progress(&channel, &job.id, "synthesizing");
        synthesize_stream(&profile, url, &text, &key, &job.token, &sender).await
    }
    .await;
    drop(sender);
    if synthesized.is_err() {
        job.token.cancel();
    }
    let played = worker
        .await
        .unwrap_or_else(|_| Err("音频播放任务失败。".into()));
    let (result, phase) = speech_outcome(synthesized, played);
    progress(&channel, &job.id, phase);
    result
}

#[cfg(test)]
mod tests;

#[cfg(all(test, target_os = "macos"))]
mod audition;
