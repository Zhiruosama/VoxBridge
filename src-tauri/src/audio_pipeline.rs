use crate::pcm::Frame;
use std::collections::VecDeque;

const RATE: u32 = 16_000;
const BLOCK: usize = 320;
const MAX_SEGMENT: usize = 8 * RATE as usize;

pub struct AudioSegment {
    pub sequence: u64,
    pub start_ms: u64,
    pub wav: Vec<u8>,
}

pub(crate) struct Resampler {
    rate: u32,
    history: VecDeque<f32>,
    input_count: u64,
    output_count: u64,
    kernels: Vec<[f64; 128]>,
}

impl Resampler {
    pub(crate) fn new(rate: u32) -> Self {
        let cutoff = 0.45 * (f64::from(RATE) / f64::from(rate)).min(1.0);
        let kernels = (0..256)
            .map(|phase| {
                let fraction = f64::from(phase) / 256.0;
                let mut kernel = [0.0; 128];
                let mut total = 0.0;
                for (i, weight) in kernel.iter_mut().enumerate() {
                    let distance = i as f64 - 63.0 - fraction;
                    let argument = 2.0 * cutoff * distance;
                    let sinc = if argument.abs() < 1e-12 {
                        1.0
                    } else {
                        (std::f64::consts::PI * argument).sin() / (std::f64::consts::PI * argument)
                    };
                    let window = 0.5 + 0.5 * (std::f64::consts::PI * distance / 64.0).cos();
                    *weight = 2.0 * cutoff * sinc * window.max(0.0);
                    total += *weight;
                }
                for weight in &mut kernel {
                    *weight /= total;
                }
                kernel
            })
            .collect();
        Self {
            rate,
            history: VecDeque::with_capacity(256),
            input_count: 0,
            output_count: 0,
            kernels,
        }
    }

    fn reset(&mut self) {
        self.history.clear();
        self.input_count = 0;
        self.output_count = 0;
    }

    pub(crate) fn push(&mut self, value: f32, mut output: impl FnMut(f32)) {
        self.history.push_back(value);
        self.input_count += 1;
        loop {
            let position = self.output_count * u64::from(self.rate);
            let center = position / u64::from(RATE);
            if center + 64 >= self.input_count {
                break;
            }
            let phase = ((position % u64::from(RATE)) * 256 / u64::from(RATE)) as usize;
            let first = self.input_count as i64 - self.history.len() as i64;
            let mut sample = 0.0;
            for (i, weight) in self.kernels[phase].iter().enumerate() {
                let index = center as i64 + i as i64 - 63;
                if index >= first && index >= 0 {
                    if let Some(value) = self.history.get((index - first) as usize) {
                        sample += f64::from(*value) * weight;
                    }
                }
            }
            output(sample.clamp(-1.0, 1.0) as f32);
            self.output_count += 1;
        }
        while self.history.len() > 128 {
            self.history.pop_front();
        }
    }
}

struct Segmenter {
    block: Vec<f32>,
    pre_roll: VecDeque<f32>,
    active: Vec<f32>,
    voice_samples: usize,
    silent_samples: usize,
    consumed: u64,
    start_sample: u64,
}

impl Segmenter {
    fn new() -> Self {
        Self {
            block: Vec::with_capacity(BLOCK),
            pre_roll: VecDeque::with_capacity(3200),
            active: Vec::with_capacity(MAX_SEGMENT),
            voice_samples: 0,
            silent_samples: 0,
            consumed: 0,
            start_sample: 0,
        }
    }

    fn reset(&mut self) {
        self.block.clear();
        self.pre_roll.clear();
        self.active.clear();
        self.voice_samples = 0;
        self.silent_samples = 0;
        self.consumed = 0;
    }

    fn push(&mut self, sample: f32) -> Option<(u64, Vec<i16>)> {
        self.block.push(sample);
        if self.block.len() != BLOCK {
            return None;
        }
        let energy = self
            .block
            .iter()
            .map(|sample| f64::from(*sample).powi(2))
            .sum::<f64>()
            / BLOCK as f64;
        let voice = energy.sqrt() >= 0.008;
        if self.active.is_empty() && voice {
            self.start_sample = self.consumed.saturating_sub(self.pre_roll.len() as u64);
            self.active.extend(self.pre_roll.drain(..));
        }
        if !self.active.is_empty() || voice {
            self.active.extend_from_slice(&self.block);
            if voice {
                self.voice_samples += BLOCK;
                self.silent_samples = 0;
            } else {
                self.silent_samples += BLOCK;
            }
        } else {
            self.pre_roll.extend(self.block.iter().copied());
            while self.pre_roll.len() > 3200 {
                self.pre_roll.pop_front();
            }
        }
        self.consumed += BLOCK as u64;
        self.block.clear();
        if self.silent_samples < 9600 && self.active.len() < MAX_SEGMENT {
            return None;
        }
        // Keep brief spoken answers (120 ms voiced); reject isolated clicks.
        let result = if self.voice_samples >= 1920 {
            Some((
                self.start_sample,
                self.active
                    .iter()
                    .map(|sample| (sample * 32767.0).round() as i16)
                    .collect(),
            ))
        } else {
            None
        };
        self.active.clear();
        self.voice_samples = 0;
        self.silent_samples = 0;
        result
    }
}

pub fn encode_wav(samples: &[i16]) -> Vec<u8> {
    let size = (samples.len() * 2) as u32;
    let mut wav = Vec::with_capacity(44 + size as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + size).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&RATE.to_le_bytes());
    wav.extend_from_slice(&(RATE * 2).to_le_bytes());
    wav.extend_from_slice(&2_u16.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&size.to_le_bytes());
    for sample in samples {
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    wav
}

pub struct AudioPipeline {
    resampler: Resampler,
    segmenter: Segmenter,
    next_index: Option<u64>,
    origin: u64,
    sequence: u64,
    pub discontinuities: u64,
}

impl AudioPipeline {
    pub fn new(rate: u32) -> Result<Self, String> {
        if !(8000..=192000).contains(&rate) {
            return Err("采集采样率无法转换。".into());
        }
        Ok(Self {
            resampler: Resampler::new(rate),
            segmenter: Segmenter::new(),
            next_index: None,
            origin: 0,
            sequence: 0,
            discontinuities: 0,
        })
    }

    pub fn consume(&mut self, frame: Frame) -> Option<AudioSegment> {
        if self.next_index.is_some_and(|index| index != frame.index) {
            self.discontinuities += 1;
            self.resampler.reset();
            self.segmenter.reset();
            self.origin = frame.index;
        } else if self.next_index.is_none() {
            self.origin = frame.index;
        }
        self.next_index = Some(frame.index + 1);
        let mut completed = None;
        let segmenter = &mut self.segmenter;
        let mono = frame
            .samples
            .iter()
            .map(|sample| {
                if sample.is_finite() {
                    sample.clamp(-1.0, 1.0)
                } else {
                    0.0
                }
            })
            .sum::<f32>()
            * 0.5;
        self.resampler.push(mono, |sample| {
            if let Some(segment) = segmenter.push(sample) {
                completed = Some(segment);
            }
        });
        completed.map(|(start, samples)| {
            self.sequence += 1;
            AudioSegment {
                sequence: self.sequence,
                start_ms: self.origin * 1000 / u64::from(self.resampler.rate)
                    + start * 1000 / u64::from(RATE),
                wav: encode_wav(&samples),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn convert(rate: u32, frequency: f64) -> Vec<f32> {
        let mut resampler = Resampler::new(rate);
        let mut output = Vec::new();
        for i in 0..rate {
            let sample = (2.0 * std::f64::consts::PI * frequency * f64::from(i) / f64::from(rate))
                .sin() as f32;
            resampler.push(sample, |sample| output.push(sample));
        }
        output
    }

    #[test]
    fn rates_preserve_duration_and_voice_frequency() {
        for rate in [8000, 16000, 44100, 48000, 96000, 192000] {
            let output = convert(rate, 1000.0);
            assert!((output.len() as i64 - 16000).abs() <= 130);
            let rms = (output[300..]
                .iter()
                .map(|v| f64::from(*v).powi(2))
                .sum::<f64>()
                / (output.len() - 300) as f64)
                .sqrt();
            assert!((rms - 0.707).abs() < 0.06, "rate {rate}: {rms}");
            let crossings = output
                .windows(2)
                .filter(|v| v[0] <= 0.0 && v[1] > 0.0)
                .count();
            assert!((crossings as i64 - 1000).abs() < 15);
        }
    }

    #[test]
    fn downsampling_filters_out_of_band_audio() {
        let output = convert(48000, 12000.0);
        let rms = (output[300..]
            .iter()
            .map(|v| f64::from(*v).powi(2))
            .sum::<f64>()
            / (output.len() - 300) as f64)
            .sqrt();
        assert!(rms < 0.02, "alias RMS {rms}");
    }

    #[test]
    fn silence_is_not_sent_and_voice_is_encoded_as_bounded_wav() {
        let mut pipeline = AudioPipeline::new(16000).unwrap();
        let mut segments = Vec::new();
        for index in 0..32000 {
            let value = if (3200..16000).contains(&index) {
                0.2
            } else {
                0.0
            };
            if let Some(segment) = pipeline.consume(Frame {
                index,
                samples: [value; 2],
            }) {
                segments.push(segment);
            }
        }
        assert_eq!(segments.len(), 1);
        let segment = &segments[0];
        assert!(crate::asr::validate_wav(&segment.wav).unwrap() < 2.0);
        assert_eq!(segment.sequence, 1);
        assert!(segment.start_ms <= 200);
        let mut silence = AudioPipeline::new(48000).unwrap();
        for index in 0..48000 {
            assert!(silence
                .consume(Frame {
                    index,
                    samples: [0.0; 2]
                })
                .is_none());
        }
    }

    #[test]
    fn discontinuity_discards_partial_segment_and_sequence_stays_unique() {
        let mut pipeline = AudioPipeline::new(16000).unwrap();
        for index in 0..6400 {
            pipeline.consume(Frame {
                index,
                samples: [0.2; 2],
            });
        }
        let mut segments = Vec::new();
        for index in 10000..42000 {
            let value = if index < 26000 { 0.2 } else { 0.0 };
            if let Some(segment) = pipeline.consume(Frame {
                index,
                samples: [value; 2],
            }) {
                segments.push(segment);
            }
        }
        assert_eq!(pipeline.discontinuities, 1);
        assert_eq!(segments.len(), 1);
        assert!(segments[0].start_ms >= 625);
    }

    #[test]
    fn uninterrupted_audio_forces_a_bounded_segment() {
        let mut pipeline = AudioPipeline::new(16000).unwrap();
        let mut segments = Vec::new();
        for index in 0..16000 * 17 {
            if let Some(segment) = pipeline.consume(Frame {
                index,
                samples: [0.2; 2],
            }) {
                segments.push(segment);
            }
        }
        assert_eq!(segments.len(), 2);
        for segment in segments {
            assert!(crate::asr::validate_wav(&segment.wav).unwrap() <= 8.0);
        }
    }
}

#[cfg(test)]
mod short_answers {
    use super::*;
    #[test]
    fn short_voiced_answers_survive_but_clicks_and_silence_do_not() {
        for rate in [16000, 48000] {
            for (duration_ms, expected) in [(0, 0), (20, 0), (80, 0), (200, 1), (400, 1)] {
                let mut pipeline = AudioPipeline::new(rate).unwrap();
                let mut segments = Vec::new();
                for index in 0..u64::from(rate) * 2 {
                    let sample = if index < u64::from(rate) * duration_ms / 1000 {
                        (index as f32 * 200.0 * std::f32::consts::TAU / rate as f32).sin() * 0.1
                    } else {
                        0.0
                    };
                    if let Some(segment) = pipeline.consume(Frame {
                        index,
                        samples: [sample; 2],
                    }) {
                        segments.push(segment);
                    }
                }
                assert_eq!(
                    segments.len(),
                    expected,
                    "rate={rate}, voice={duration_ms}ms"
                );
                for segment in segments {
                    assert!(crate::asr::validate_wav(&segment.wav).unwrap() >= 0.1);
                }
            }
        }
    }
}
