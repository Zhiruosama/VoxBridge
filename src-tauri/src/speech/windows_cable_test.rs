//! Opt-in hardware test: generated tones only, no provider or physical microphone.
use super::*;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

fn capture<T: cpal::SizedSample>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    samples: Arc<Mutex<Vec<f32>>>,
    failed: Arc<AtomicBool>,
) -> cpal::Stream
where
    f32: cpal::FromSample<T>,
{
    let channels = usize::from(config.channels);
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                let mut samples = samples.lock().unwrap();
                let remaining = 480_000usize.saturating_sub(samples.len());
                samples.extend(
                    data.chunks_exact(channels)
                        .take(remaining)
                        .map(|frame| frame[0].to_sample::<f32>()),
                );
            },
            move |_| failed.store(true, Ordering::SeqCst),
            None,
        )
        .unwrap()
}

fn tone(frequency: f32) -> Vec<u8> {
    let rate = 24_000u32;
    let frames = rate / 2;
    let bytes = frames * 2;
    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + bytes).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&rate.to_le_bytes());
    wav.extend_from_slice(&(rate * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&bytes.to_le_bytes());
    for frame in 0..frames {
        let envelope = ((frame.min(frames - 1 - frame) as f32) / 240.0).min(1.0);
        let sample = (0.2
            * envelope
            * (std::f32::consts::TAU * frequency * frame as f32 / rate as f32).sin()
            * i16::MAX as f32) as i16;
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    wav
}

#[test]
#[ignore = "manual hardware: sends three generated tones through base VB-CABLE and captures only its virtual input"]
fn windows_cable_roundtrip() {
    let output = crate::platform::list_outputs()
        .unwrap()
        .into_iter()
        .find(|d| crate::platform::is_cable_endpoint(&d.name, "input"))
        .expect("base VB-CABLE playback endpoint required");
    let inputs: Vec<_> = cpal::default_host()
        .input_devices()
        .unwrap()
        .filter(|device| {
            let description = device.description().unwrap();
            let name = description
                .extended()
                .first()
                .map_or(description.name(), String::as_str);
            crate::platform::is_cable_endpoint(name, "output")
        })
        .collect();
    assert_eq!(
        inputs.len(),
        1,
        "require exactly one base virtual capture endpoint"
    );
    let input = &inputs[0];
    let config = input.default_input_config().unwrap();
    let rate = config.sample_rate() as f32;
    let samples = Arc::new(Mutex::new(Vec::new()));
    let failed = Arc::new(AtomicBool::new(false));
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            capture::<f32>(input, &config.into(), samples.clone(), failed.clone())
        }
        cpal::SampleFormat::I16 => {
            capture::<i16>(input, &config.into(), samples.clone(), failed.clone())
        }
        cpal::SampleFormat::I32 => {
            capture::<i32>(input, &config.into(), samples.clone(), failed.clone())
        }
        format => panic!("unsupported test capture format: {format:?}"),
    };
    stream.play().unwrap();
    std::thread::sleep(Duration::from_millis(300));
    let frequencies = [523.0, 941.0, 1511.0];
    for (index, frequency) in frequencies.iter().enumerate() {
        let (tx, rx) = std::sync::mpsc::channel();
        tx.send(tone(*frequency)).unwrap();
        drop(tx);
        let (ready, _rx) = tokio::sync::oneshot::channel();
        playback(
            output.id.clone(),
            None,
            Arc::new(AtomicBool::new(false)),
            CancellationToken::new(),
            ready,
            rx,
            tauri::ipc::Channel::new(|_| Ok(())),
            format!("local-cable-test-{index}"),
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(250));
    }
    drop(stream);
    assert!(
        !failed.load(Ordering::SeqCst),
        "virtual capture stream error"
    );
    let samples = samples.lock().unwrap();
    assert!(samples.len() > rate as usize, "not enough captured audio");
    let mut positions = Vec::new();
    for frequency in frequencies {
        let (position, amplitude) = samples
            .windows(2048)
            .step_by(512)
            .enumerate()
            .map(|(i, window)| {
                let (mut real, mut imaginary) = (0.0f32, 0.0f32);
                for (n, sample) in window.iter().enumerate() {
                    let phase = std::f32::consts::TAU * frequency * n as f32 / rate;
                    real += sample * phase.cos();
                    imaginary += sample * phase.sin();
                }
                (i * 512, 2.0 * real.hypot(imaginary) / window.len() as f32)
            })
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .unwrap();
        assert!(
            amplitude > 0.03,
            "missing {frequency} Hz test signal: {amplitude}"
        );
        positions.push(position);
        println!("VB-CABLE {frequency} Hz: amplitude {amplitude:.3}, position {position}");
    }
    assert!(
        positions.windows(2).all(|pair| pair[0] < pair[1]),
        "tone order changed"
    );
    assert!(
        samples
            .iter()
            .all(|sample| sample.is_finite() && sample.abs() < 0.95),
        "clipping or invalid capture"
    );
    println!(
        "VB-CABLE roundtrip passed at {rate} Hz; {} mono frames, no stream error",
        samples.len()
    );
}
