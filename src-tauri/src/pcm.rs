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

#[derive(Default)]
pub struct Meter {
    pub frames: u64,
    pub gaps: u64,
    next_index: u64,
    energy: f64,
    window_frames: u64,
}

impl Meter {
    pub fn consume(&mut self, frame: Frame) {
        self.gaps += frame.index.saturating_sub(self.next_index);
        self.next_index = frame.index + 1;
        self.frames += 1;
        self.window_frames += 1;
        self.energy += frame
            .samples
            .iter()
            .map(|sample| f64::from(*sample).powi(2))
            .sum::<f64>();
    }

    pub fn rms(&mut self) -> f64 {
        let rms = if self.window_frames == 0 {
            0.0
        } else {
            (self.energy / (self.window_frames * 2) as f64).sqrt()
        };
        self.window_frames = 0;
        self.energy = 0.0;
        rms
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
