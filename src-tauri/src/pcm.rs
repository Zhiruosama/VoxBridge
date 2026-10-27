use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

#[derive(Clone, Copy)]
pub struct Frame {
    pub index: u64,
    pub samples: [f32; 2],
}

pub struct PcmWriter {
    producer: rtrb::Producer<Frame>,
    next_index: u64,
    dropped: Arc<AtomicU64>,
}

pub fn channel(capacity: usize) -> (PcmWriter, rtrb::Consumer<Frame>, Arc<AtomicU64>) {
    let (producer, consumer) = rtrb::RingBuffer::new(capacity);
    let dropped = Arc::new(AtomicU64::new(0));
    (
        PcmWriter {
            producer,
            next_index: 0,
            dropped: dropped.clone(),
        },
        consumer,
        dropped,
    )
}

impl PcmWriter {
    pub(crate) fn mark_discontinuity(&mut self) {
        self.next_index += 1;
        self.dropped.fetch_add(1, Ordering::Relaxed);
    }
    fn write_frames(&mut self, frames: impl Iterator<Item = [f32; 2]>) {
        let mut dropped = 0;
        for samples in frames {
            let frame = Frame {
                index: self.next_index,
                samples: samples.map(|sample| {
                    if sample.is_finite() {
                        sample.clamp(-1.0, 1.0)
                    } else {
                        0.0
                    }
                }),
            };
            self.next_index += 1;
            if self.producer.push(frame).is_err() {
                dropped += 1;
            }
        }
        if dropped != 0 {
            self.dropped.fetch_add(dropped, Ordering::Relaxed);
        }
    }

    pub fn write_stereo(&mut self, samples: &[f32]) {
        self.write_frames(samples.as_chunks::<2>().0.iter().copied());
    }

    pub fn write_planar(&mut self, left: &[f32], right: &[f32]) {
        self.write_frames(left.iter().zip(right).map(|(left, right)| [*left, *right]));
    }
}

#[derive(Clone, Copy, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioQuality {
    pub mono_rms: f64,
    pub near_peak_frames: u64,
    pub low_downmix_windows: u64,
}

#[derive(Default)]
pub struct Meter {
    pub frames: u64,
    pub gaps: u64,
    next_index: u64,
    energy: f64,
    mono_energy: f64,
    quality: AudioQuality,
    window_frames: u64,
}

impl Meter {
    pub fn consume(&mut self, frame: Frame) {
        self.gaps += frame.index.saturating_sub(self.next_index);
        self.next_index = frame.index + 1;
        self.frames += 1;
        self.window_frames += 1;
        let mono = (f64::from(frame.samples[0]) + f64::from(frame.samples[1])) * 0.5;
        self.mono_energy += mono * mono;
        self.quality.near_peak_frames += u64::from(frame.samples.iter().any(|s| s.abs() >= 0.999));
        self.energy += frame
            .samples
            .iter()
            .map(|sample| f64::from(*sample).powi(2))
            .sum::<f64>();
    }

    pub fn quality(&self) -> AudioQuality {
        self.quality
    }

    pub fn rms(&mut self) -> f64 {
        let rms = if self.window_frames == 0 {
            0.0
        } else {
            (self.energy / (self.window_frames * 2) as f64).sqrt()
        };
        self.quality.mono_rms = if self.window_frames == 0 {
            0.0
        } else {
            (self.mono_energy / self.window_frames as f64).sqrt()
        };
        // A diagnostic hint only: do not change channels or apply automatic gain.
        if self.window_frames >= 320 && rms >= 0.008 && self.quality.mono_rms < rms * 0.1 {
            self.quality.low_downmix_windows += 1;
        }
        self.mono_energy = 0.0;
        self.window_frames = 0;
        self.energy = 0.0;
        rms
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_discontinuity_is_preserved_in_the_source_timeline() {
        let (mut writer, mut reader, dropped) = channel(8);
        writer.write_stereo(&[0.0, 0.0]);
        writer.mark_discontinuity();
        writer.write_stereo(&[0.1, 0.1]);
        let mut meter = Meter::default();
        meter.consume(reader.pop().unwrap());
        meter.consume(reader.pop().unwrap());
        assert_eq!(meter.gaps, 1);
        assert_eq!(dropped.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn stereo_frames_keep_sequence_and_sanitize_invalid_samples() {
        let (mut writer, mut reader, dropped) = channel(8);
        writer.write_stereo(&[0.5, -0.5, f32::NAN, f32::INFINITY, 2.0, -2.0]);
        let mut meter = Meter::default();
        while let Ok(frame) = reader.pop() {
            assert!(frame.samples.iter().all(|sample| sample.is_finite()));
            meter.consume(frame);
        }
        assert_eq!(meter.frames, 3);
        assert_eq!(meter.gaps, 0);
        assert_eq!(dropped.load(Ordering::Relaxed), 0);
        assert!((meter.rms() - (5.0_f64 / 12.0).sqrt()).abs() < 0.000001);
        assert_eq!(meter.rms(), 0.0);
    }

    #[test]
    fn planar_input_keeps_left_and_right_aligned() {
        let (mut writer, mut reader, _) = channel(8);
        writer.write_planar(&[0.25, 0.5], &[-0.25, -0.5]);
        assert_eq!(reader.pop().unwrap().samples, [0.25, -0.25]);
        assert_eq!(reader.pop().unwrap().samples, [0.5, -0.5]);
        assert!(reader.pop().is_err());
    }

    #[test]
    fn full_buffer_drops_new_frames_and_records_discontinuity() {
        let (mut writer, mut reader, dropped) = channel(2);
        writer.write_stereo(&[0.0; 8]);
        assert_eq!(dropped.load(Ordering::Relaxed), 2);
        let mut meter = Meter::default();
        meter.consume(reader.pop().unwrap());
        meter.consume(reader.pop().unwrap());
        writer.write_stereo(&[0.0; 2]);
        let frame = reader.pop().unwrap();
        assert_eq!(frame.index, 4);
        meter.consume(frame);
        assert_eq!(meter.gaps, 2);
        assert_eq!(meter.frames, 3);
    }
}

#[cfg(test)]
mod quality_tests {
    use super::*;
    #[test]
    fn measures_mono_cancellation_without_changing_audio() {
        let mut meter = Meter::default();
        for index in 0..16000 {
            meter.consume(Frame {
                index,
                samples: [0.1, -0.1],
            });
        }
        assert!((meter.rms() - 0.1).abs() < 0.000001);
        assert_eq!(meter.quality().mono_rms, 0.0);
        assert_eq!(meter.quality().low_downmix_windows, 1);
        assert_eq!(meter.quality().near_peak_frames, 0);
        for index in 16000..32000 {
            meter.consume(Frame {
                index,
                samples: [0.1; 2],
            });
        }
        meter.rms();
        assert!((meter.quality().mono_rms - 0.1).abs() < 0.000001);
        assert_eq!(meter.quality().low_downmix_windows, 1);
        meter.rms();
        assert_eq!(meter.quality().mono_rms, 0.0);
        assert_eq!(meter.quality().low_downmix_windows, 1);
    }
    #[test]
    fn counts_near_peak_frames_once_per_frame_not_once_per_channel() {
        let mut meter = Meter::default();
        for (index, samples) in [[1.0, 1.0], [0.1, -1.0], [0.1, 0.1]]
            .into_iter()
            .enumerate()
        {
            meter.consume(Frame {
                index: index as u64,
                samples,
            });
        }
        meter.rms();
        assert_eq!(meter.quality().near_peak_frames, 2);
        assert_eq!(meter.quality().low_downmix_windows, 0);
    }
}
