//! User-initiated, bounded microphone messages. Independent of incoming application ASR.
use crate::asr::{AsrProfile, Transcript};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
struct ActiveRecording {
    id: String,
    token: CancellationToken,
    finished: Arc<AtomicBool>,
}
#[derive(Default)]
struct Registry {
    active: Option<ActiveRecording>,
    cancelled: std::collections::VecDeque<String>,
}
#[derive(Default)]
pub struct MicrophoneState(Mutex<Registry>);
impl MicrophoneState {
    fn begin(&self, id: String) -> Result<ActiveRecording, String> {
        let mut state = self.0.lock().unwrap();
        if state.active.is_some() {
            return Err("已有录音正在进行。".into());
        }
        if let Some(index) = state.cancelled.iter().position(|item| item == &id) {
            state.cancelled.remove(index);
            return Err("录音已取消。".into());
        }
        let active = ActiveRecording {
            id,
            token: CancellationToken::new(),
            finished: Arc::new(AtomicBool::new(false)),
        };
        state.active = Some(active.clone());
        Ok(active)
    }
    fn cancel(&self, id: String) {
        let mut state = self.0.lock().unwrap();
        if let Some(active) = state.active.as_ref().filter(|active| active.id == id) {
            active.token.cancel();
            return;
        }
        if state.cancelled.len() >= 64 {
            state.cancelled.pop_front();
        }
        state.cancelled.push_back(id);
    }
    fn finish(&self, id: &str) {
        if let Some(active) = self
            .0
            .lock()
            .unwrap()
            .active
            .as_ref()
            .filter(|active| active.id == id)
        {
            active.finished.store(true, Ordering::Release);
        }
    }
    fn end(&self, id: &str) {
        let mut state = self.0.lock().unwrap();
        if state.active.as_ref().is_some_and(|active| active.id == id) {
            state.active = None;
        }
    }
    pub fn stop_all(&self) {
        if let Some(active) = self.0.lock().unwrap().active.as_ref() {
            active.token.cancel();
        }
    }
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputDevice {
    id: String,
    name: String,
}
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    phase: &'static str,
    seconds: f64,
    level: f32,
}
fn device_id(device: &cpal::Device) -> Result<String, String> {
    device
        .id()
        .map(|id| format!("mic:{}", hex::encode(id.1)))
        .map_err(|_| "无法读取麦克风标识。".into())
}
fn physical(device: &cpal::Device) -> bool {
    device
        .description()
        .is_ok_and(|d| !d.name().to_lowercase().contains("voxbridge"))
        && device
            .id()
            .is_ok_and(|id| id.1 != "com.voxbridge.audio.device")
}
#[tauri::command]
pub fn list_inputs() -> Result<Vec<InputDevice>, String> {
    #[cfg(target_os = "macos")]
    {
        return crate::platform::list_inputs().map(|devices| {
            devices
                .into_iter()
                .map(|device| InputDevice {
                    id: device.id,
                    name: device.name,
                })
                .collect()
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let mut devices = Vec::new();
        for device in cpal::default_host()
            .input_devices()
            .map_err(|_| "无法列出麦克风。")?
        {
            if physical(&device) {
                if let (Ok(id), Ok(description)) = (device_id(&device), device.description()) {
                    devices.push(InputDevice {
                        id,
                        name: description.name().to_owned(),
                    });
                }
            }
        }
        Ok(devices)
    }
}
#[tauri::command]
pub fn finish_voice_input(request_id: String, state: tauri::State<'_, MicrophoneState>) {
    state.finish(&request_id);
}
#[tauri::command]
pub fn cancel_voice_input(request_id: String, state: tauri::State<'_, MicrophoneState>) {
    state.cancel(request_id);
}
struct Cleanup<'a>(&'a MicrophoneState, String);
impl Drop for Cleanup<'_> {
    fn drop(&mut self) {
        self.0.end(&self.1);
    }
}

#[cfg(target_os = "macos")]
async fn permission() -> Result<(), String> {
    use objc2::{
        msg_send,
        runtime::{AnyClass, Bool},
    };
    use objc2_foundation::NSString;
    #[link(name = "AVFoundation", kind = "framework")]
    unsafe extern "C" {}
    let (tx, rx) = tokio::sync::oneshot::channel();
    {
        let tx = Mutex::new(Some(tx));
        let block = block2::RcBlock::new(move |allowed: Bool| {
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(allowed.as_bool());
            }
        });
        unsafe {
            let class = AnyClass::get(c"AVCaptureDevice").ok_or("无法申请麦克风权限。")?;
            let media = NSString::from_str("soun");
            let status: isize = msg_send![class, authorizationStatusForMediaType: &*media];
            if status == 3 {
                return Ok(());
            }
            if status != 0 {
                return Err("请在系统设置 → 隐私与安全性 → 麦克风中允许 VoxBridge。".into());
            }
            let _: () =
                msg_send![class, requestAccessForMediaType: &*media, completionHandler: &*block];
        }
    }
    if rx.await.unwrap_or(false) {
        Ok(())
    } else {
        Err("未获得麦克风权限，请在系统设置中允许 VoxBridge。".into())
    }
}
#[cfg(not(target_os = "macos"))]
async fn permission() -> Result<(), String> {
    Ok(())
}

const MAX_SECONDS: u64 = 60;
const MAX_SAMPLES: usize = 16_000 * MAX_SECONDS as usize;
fn meter_level(energy: f64, count: u64) -> f32 {
    if count == 0 || !energy.is_finite() {
        return 0.0;
    }
    // Map microphone RMS (-60 to -12 dBFS) to a stable visual range.
    let rms = (energy / count as f64).sqrt();
    ((20.0 * rms.max(1e-6).log10() + 60.0) / 48.0).clamp(0.0, 1.0) as f32
}
fn http_ranges(samples: &[i16]) -> Vec<std::ops::Range<usize>> {
    // Preserve the short-audio adapter's 30-second/1 MB bound. Split near a quiet
    // 20 ms window, without overlap or dropping the tiny final tail.
    let mut ranges = Vec::new();
    let mut start = 0;
    while start < samples.len() {
        let remaining = samples.len() - start;
        let end = if remaining <= 28 * 16000 + 1600 {
            samples.len()
        } else {
            let search = start + 26 * 16000;
            let relative = samples[search..start + 28 * 16000]
                .as_chunks::<320>()
                .0
                .iter()
                .enumerate()
                .min_by_key(|(_, block)| {
                    block
                        .iter()
                        .map(|sample| i64::from(*sample).pow(2))
                        .sum::<i64>()
                })
                .map(|(index, _)| index * 320 + 160)
                .unwrap_or(0);
            search + relative
        };
        ranges.push(start..end);
        start = end;
    }
    ranges
}
fn audible(samples: &[i16]) -> bool {
    samples.len() >= 1600
        && samples.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / samples.len() as f64 > 100.0
}
fn record(
    device_id_value: String,
    token: CancellationToken,
    finished: Arc<AtomicBool>,
    on_progress: tauri::ipc::Channel<Progress>,
    mut audio: Option<tokio::sync::mpsc::Sender<Vec<u8>>>,
) -> Result<Vec<i16>, String> {
    let host = cpal::default_host();
    let device = if device_id_value.is_empty() {
        host.default_input_device()
    } else {
        host.input_devices()
            .map_err(|_| "无法读取麦克风。")?
            .find(|d| device_id(d).is_ok_and(|id| id == device_id_value))
    }
    .ok_or("麦克风不可用，请在设置中重新选择。")?;
    if !physical(&device) {
        return Err("请选择实体麦克风，不能录制 VoxBridge 自身输出。".into());
    }
    let config = device
        .default_input_config()
        .map_err(|_| "无法读取麦克风格式。")?;
    let channels = config.channels() as usize;
    let rate = config.sample_rate();
    if channels == 0 || channels > 8 || !(8000..=192000).contains(&rate) {
        return Err("暂不支持此麦克风格式。".into());
    }
    let (producer, mut consumer) = rtrb::RingBuffer::<f32>::new(rate as usize);
    let failed = Arc::new(AtomicBool::new(false));
    let errors = failed.clone();
    let stream_config: cpal::StreamConfig = config.clone().into();
    macro_rules! stream {
        ($t:ty, $convert:expr) => {{
            let mut producer = producer;
            let overflow = failed.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[$t], _| {
                    for frame in data.chunks_exact(channels) {
                        let value = frame.iter().map($convert).sum::<f32>() / channels as f32;
                        if producer.push(value.clamp(-1.0, 1.0)).is_err() {
                            overflow.store(true, Ordering::Release);
                        }
                    }
                },
                move |_| {
                    errors.store(true, Ordering::Release);
                },
                None,
            )
        }};
    }
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => stream!(f32, |v: &f32| *v),
        cpal::SampleFormat::I16 => stream!(i16, |v: &i16| *v as f32 / 32768.0),
        cpal::SampleFormat::I32 => stream!(i32, |v: &i32| *v as f32 / 2147483648.0),
        cpal::SampleFormat::U16 => stream!(u16, |v: &u16| (*v as f32 - 32768.0) / 32768.0),
        _ => return Err("暂不支持此麦克风采样格式。".into()),
    }
    .map_err(|_| "无法打开麦克风，请检查权限和设备连接。")?;
    stream.play().map_err(|_| "无法启动麦克风。")?;
    on_progress
        .send(Progress {
            phase: "recording",
            seconds: 0.0,
            level: 0.0,
        })
        .map_err(|_| "录音界面已关闭。")?;
    let mut resampler = crate::audio_pipeline::Resampler::new(rate);
    let mut samples = Vec::with_capacity(MAX_SAMPLES);
    let mut pending = Vec::with_capacity(640);
    let mut last = std::time::Instant::now();
    let mut last_audio = last;
    let started = last;
    let mut energy = 0.0_f64;
    let mut meter_samples = 0_u64;
    while !finished.load(Ordering::Acquire)
        && samples.len() < MAX_SAMPLES
        && started.elapsed().as_secs() < MAX_SECONDS
    {
        if token.is_cancelled() {
            return Err("录音已取消。".into());
        }
        if failed.load(Ordering::Acquire) {
            return Err("麦克风连接中断或录音处理不及，请重试。".into());
        }
        while let Ok(value) = consumer.pop() {
            if token.is_cancelled() {
                return Err("录音已取消。".into());
            }
            if samples.len() >= MAX_SAMPLES {
                break;
            }
            last_audio = std::time::Instant::now();
            energy += f64::from(value).powi(2);
            meter_samples += 1;
            resampler.push(value, |v| {
                if samples.len() < MAX_SAMPLES {
                    let sample = (v.clamp(-1.0, 1.0) * 32767.0) as i16;
                    samples.push(sample);
                    pending.extend_from_slice(&sample.to_le_bytes());
                }
            });
            if pending.len() >= 640 {
                if let Some(sender) = audio.as_mut() {
                    sender
                        .try_send(std::mem::take(&mut pending))
                        .map_err(|_| "语音识别连接中断或网络发送过慢，请重试。")?;
                } else {
                    pending.clear();
                }
            }
        }
        if last_audio.elapsed().as_secs() > 3 {
            return Err("麦克风未返回声音，请检查权限。".into());
        }
        if last.elapsed().as_millis() >= 50 {
            on_progress
                .send(Progress {
                    phase: "recording",
                    seconds: samples.len() as f64 / 16000.0,
                    level: meter_level(energy, meter_samples),
                })
                .map_err(|_| "录音界面已关闭。")?;
            energy = 0.0;
            meter_samples = 0;
            last = std::time::Instant::now();
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    drop(stream);
    // Flush the finite resampler delay so the last phoneme is not clipped.
    for _ in 0..64 {
        resampler.push(0.0, |v| {
            if samples.len() < MAX_SAMPLES {
                let sample = (v.clamp(-1.0, 1.0) * 32767.0) as i16;
                samples.push(sample);
                pending.extend_from_slice(&sample.to_le_bytes());
            }
        });
    }
    if let Some(sender) = audio {
        if !pending.is_empty() {
            let _ = sender.try_send(pending);
        }
    }
    if !audible(&samples) {
        return Err("没有听到清晰语音，请靠近麦克风重试。".into());
    }
    on_progress
        .send(Progress {
            phase: "recognizing",
            seconds: samples.len() as f64 / 16000.0,
            level: 0.0,
        })
        .map_err(|_| "录音界面已关闭。")?;
    Ok(samples)
}

#[tauri::command]
pub async fn start_voice_input(
    request_id: String,
    device_id: String,
    profile: AsrProfile,
    on_progress: tauri::ipc::Channel<Progress>,
    state: tauri::State<'_, MicrophoneState>,
) -> Result<Transcript, String> {
    crate::asr::endpoint(&profile)?;
    let active = state.begin(request_id.clone())?;
    let token = active.token;
    let finished = active.finished;
    let _cleanup = Cleanup(&state, request_id);
    let key = tokio::select! { _ = token.cancelled() => return Err("录音已取消。".into()), result = crate::credentials::read_async(&profile.id) => result? };
    tokio::select! { _ = token.cancelled() => return Err("录音已取消。".into()), result = permission() => result? }
    let capture_token = token.clone();
    let samples = if profile.is_realtime() {
        let (tx, rx) = tokio::sync::mpsc::channel(64);
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let mut sentences = std::collections::BTreeMap::new();
        let capture = async {
            tokio::select! { _ = token.cancelled() => return Err("录音已取消。".into()), result = ready_rx => result.map_err(|_| "语音识别未就绪。")? }
            let result = tokio::task::spawn_blocking(move || {
                record(device_id, capture_token, finished, on_progress, Some(tx))
            })
            .await
            .map_err(|_| "录音任务失败。")?;
            if result.is_err() {
                token.cancel();
            }
            result
        };
        let recognition = crate::asr::realtime::recognize_stream(
            &profile,
            &key,
            &token,
            rx,
            ready_tx,
            |sentence| {
                sentences.insert(sentence.id, sentence.text);
                Ok(())
            },
        );
        let (captured, recognized) = tokio::join!(capture, recognition);
        let samples = captured?;
        recognized?;
        if token.is_cancelled() {
            return Err("录音已取消。".into());
        }
        let text = sentences.into_values().collect::<Vec<_>>().join(" ");
        if text.trim().is_empty() {
            return Err("没有识别出语音，请重试。".into());
        }
        return Ok(Transcript {
            text,
            audio_seconds: samples.len() as f64 / 16000.0,
        });
    } else {
        tokio::task::spawn_blocking(move || {
            record(device_id, capture_token, finished, on_progress, None)
        })
        .await
        .map_err(|_| "录音任务失败。")??
    };
    let mut parts = Vec::new();
    for range in http_ranges(&samples) {
        if token.is_cancelled() {
            return Err("录音已取消。".into());
        }
        parts.push(
            crate::asr::recognize(
                &profile,
                &crate::audio_pipeline::encode_wav(&samples[range]),
                &key,
                &token,
            )
            .await?
            .text,
        );
    }
    Ok(Transcript {
        text: parts.join(" "),
        audio_seconds: samples.len() as f64 / 16000.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn minute_recording_is_split_into_valid_http_audio_without_losing_samples() {
        for length in [1600, 28 * 16000, 28 * 16000 + 1601, 45 * 16000, MAX_SAMPLES] {
            let samples = vec![1000_i16; length];
            let ranges = http_ranges(&samples);
            let mut end = 0;
            for range in ranges {
                assert_eq!(range.start, end);
                assert!(range.end > range.start);
                let wav = crate::audio_pipeline::encode_wav(&samples[range.clone()]);
                let seconds = crate::asr::validate_wav(&wav).unwrap();
                assert!((0.1..=30.0).contains(&seconds));
                end = range.end;
            }
            assert_eq!(end, length);
        }
    }
    #[test]
    fn http_audio_split_prefers_a_quiet_boundary() {
        let mut samples = vec![1000_i16; MAX_SAMPLES];
        samples[27 * 16000..27 * 16000 + 320].fill(0);
        assert!((27 * 16000..27 * 16000 + 320).contains(&http_ranges(&samples)[0].end));
    }
    #[test]
    fn audio_meter_tracks_volume_and_handles_silence_or_invalid_samples() {
        assert_eq!(meter_level(0.0, 1600), 0.0);
        assert_eq!(meter_level(1.0, 0), 0.0);
        assert_eq!(meter_level(f64::NAN, 1600), 0.0);
        assert!(meter_level(0.16, 1600) < meter_level(16.0, 1600));
        assert_eq!(meter_level(1600.0, 1600), 1.0);
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn settings_inventory_does_not_request_microphone_access() {
        use objc2::{msg_send, runtime::AnyClass};
        let class = AnyClass::get(c"AVCaptureDevice").expect("AVFoundation must be linked");
        let media = objc2_foundation::NSString::from_str("soun");
        let status: isize = unsafe { msg_send![class, authorizationStatusForMediaType: &*media] };
        assert!((0..=3).contains(&status));
        // Reading settings inventory must not initialize an input AudioUnit or request TCC access.
        for _ in 0..3 {
            let inputs = list_inputs().unwrap();
            let outputs = crate::platform::list_outputs().unwrap();
            assert!(inputs.iter().all(|device| device.id.starts_with("mic:")
                && !device.name.to_lowercase().contains("voxbridge")));
            assert!(outputs
                .iter()
                .all(|device| device.id.starts_with("macos-output:")));
        }
        let after: isize = unsafe { msg_send![class, authorizationStatusForMediaType: &*media] };
        assert_eq!(
            status, after,
            "Settings inventory must leave microphone authorization unchanged"
        );
    }
    #[test]
    #[ignore = "manual read-only device enumeration; does not open or record microphones"]
    fn enumerate_real_inputs_excludes_our_output() {
        let inputs = list_inputs().unwrap();
        assert!(!inputs.is_empty());
        assert!(inputs.iter().all(|input| input.id.starts_with("mic:")
            && !input.name.to_lowercase().contains("voxbridge")));
        println!("Available input devices: {}", inputs.len());
    }
    #[test]
    fn finish_drains_asr_but_cancel_aborts_and_old_ids_cannot_stop_new_recordings() {
        let state = MicrophoneState::default();
        let first = state.begin("first".into()).unwrap();
        assert!(state.begin("second".into()).is_err());
        state.finish("first");
        assert!(first.finished.load(Ordering::Acquire));
        assert!(!first.token.is_cancelled());
        state.cancel("first".into());
        assert!(first.token.is_cancelled());
        state.end("first");
        let second = state.begin("second".into()).unwrap();
        state.finish("first");
        state.end("first");
        assert!(!second.finished.load(Ordering::Acquire));
        assert!(!second.token.is_cancelled());
        assert!(state.begin("third".into()).is_err());
        state.stop_all();
        assert!(second.token.is_cancelled());
    }
    #[test]
    fn cancel_before_start_is_remembered_and_bounded() {
        let state = MicrophoneState::default();
        for i in 0..100 {
            state.cancel(format!("cancelled-{i}"));
        }
        assert_eq!(state.0.lock().unwrap().cancelled.len(), 64);
        assert!(state.begin("cancelled-99".into()).is_err());
        assert!(state.begin("fresh".into()).is_ok());
    }
    #[test]
    fn silence_and_too_short_recordings_cannot_be_sent() {
        assert!(!audible(&vec![0; 16000]));
        assert!(!audible(&[1000; 100]));
        assert!(!audible(&vec![2; 16000]));
        assert!(audible(&vec![1000; 16000]));
    }
}
