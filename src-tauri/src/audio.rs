use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

#[derive(Default)]
pub struct ToneState(pub Arc<AtomicU64>);

#[derive(Serialize)]
pub struct OutputDevice {
    id: String,
    name: String,
}

#[tauri::command]
pub fn list_outputs() -> Result<Vec<OutputDevice>, String> {
    let devices = cpal::default_host()
        .output_devices()
        .map_err(|_| "无法枚举输出设备。")?;
    // The diagnostic probe deliberately uses transient IDs; production routing needs platform UIDs.
    devices
        .map(|device| {
            let name = device.name().map_err(|_| "无法读取设备名称。")?;
            Ok(OutputDevice {
                id: name.clone(),
                name,
            })
        })
        .collect()
}

#[tauri::command]
pub fn stop_tone(state: tauri::State<'_, ToneState>) {
    state.0.fetch_add(1, Ordering::SeqCst);
}

fn fill<T: cpal::Sample + cpal::FromSample<f32>>(
    data: &mut [T],
    channels: usize,
    rate: f32,
    position: &mut usize,
    token: &AtomicU64,
    generation: u64,
) {
    for frame in data.chunks_mut(channels) {
        let active = token.load(Ordering::SeqCst) == generation && *position < (rate as usize);
        let time = *position as f32 / rate;
        let fade = (time * 100.0).min(1.0) * ((1.0 - time).max(0.0) * 100.0).min(1.0);
        let value = if active {
            (time * 440.0 * std::f32::consts::TAU).sin() * 0.06 * fade
        } else {
            0.0
        };
        for sample in frame {
            *sample = T::from_sample(value);
        }
        *position += 1;
    }
}

fn play_tone(device_id: String, token: Arc<AtomicU64>, generation: u64) -> Result<(), String> {
    let mut matches = cpal::default_host()
        .output_devices()
        .map_err(|_| "无法枚举设备。")?
        .filter(|device| device.name().is_ok_and(|name| name == device_id));
    let device = matches.next().ok_or("设备已断开，请刷新设备列表。")?;
    if matches.next().is_some() {
        return Err("检测到同名设备，诊断版无法区分，请先断开多余同名设备。".into());
    }
    let config = device
        .default_output_config()
        .map_err(|_| "设备不支持默认输出格式。")?;
    let rate = config.sample_rate().0 as f32;
    let channels = config.channels() as usize;
    let stream_config: cpal::StreamConfig = config.clone().into();
    let failed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => build_stream::<f32>(
            &device,
            &stream_config,
            channels,
            rate,
            token,
            generation,
            failed.clone(),
        ),
        cpal::SampleFormat::I16 => build_stream::<i16>(
            &device,
            &stream_config,
            channels,
            rate,
            token,
            generation,
            failed.clone(),
        ),
        cpal::SampleFormat::U16 => build_stream::<u16>(
            &device,
            &stream_config,
            channels,
            rate,
            token,
            generation,
            failed.clone(),
        ),
        _ => return Err("诊断测试暂不支持此设备采样格式。".into()),
    }?;
    stream
        .play()
        .map_err(|_| "无法开始播放，请检查设备权限。")?;
    std::thread::sleep(Duration::from_millis(1150));
    drop(stream);
    if failed.load(Ordering::SeqCst) {
        Err("播放设备发生错误，请刷新设备后重试。".into())
    } else {
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
fn build_stream<T: cpal::SizedSample + cpal::FromSample<f32>>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    rate: f32,
    token: Arc<AtomicU64>,
    generation: u64,
    failed: Arc<std::sync::atomic::AtomicBool>,
) -> Result<cpal::Stream, String> {
    let mut position = 0;
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _| fill(data, channels, rate, &mut position, &token, generation),
            move |_| {
                failed.store(true, Ordering::SeqCst);
            },
            None,
        )
        .map_err(|_| "无法打开选定输出设备。".into())
}

#[tauri::command]
pub async fn test_tone(
    device_id: String,
    state: tauri::State<'_, ToneState>,
    gate: tauri::State<'_, crate::speech::AudioGate>,
) -> Result<(), String> {
    let _permit = gate
        .0
        .clone()
        .try_acquire_owned()
        .map_err(|_| "音频输出正忙，请先停止当前任务。")?;
    let token = state.0.clone();
    let generation = token.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || play_tone(device_id, token, generation))
        .await
        .map_err(|_| "音频测试任务失败。".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tone_has_expected_length_channels_and_stops_on_generation_change() {
        let token = AtomicU64::new(1);
        let mut position = 0;
        let mut samples = vec![0.0_f32; 48_000 * 2 + 100];
        fill(&mut samples, 2, 48_000.0, &mut position, &token, 1);
        assert!(samples[..96_000].iter().any(|s| s.abs() > 0.05));
        assert!(samples.iter().all(|s| s.abs() <= 0.061));
        assert!(samples
            .as_chunks::<2>()
            .0
            .iter()
            .all(|frame| frame[0] == frame[1]));
        assert!(samples[96_000..].iter().all(|s| *s == 0.0));
        token.store(2, Ordering::SeqCst);
        fill(&mut samples, 2, 48_000.0, &mut 100, &token, 1);
        assert!(samples.iter().all(|s| *s == 0.0));
    }
}
