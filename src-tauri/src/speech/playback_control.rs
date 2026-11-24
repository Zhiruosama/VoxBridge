use super::*;

const INACTIVE: u8 = 0;
const PLAYING: u8 = 1;
const PAUSED: u8 = 2;

#[derive(Default)]
pub(super) struct PlaybackControl(AtomicU8);

impl PlaybackControl {
    pub fn toggle(&self) {
        let state = self.0.load(Ordering::SeqCst);
        let next = match state {
            PLAYING => PAUSED,
            PAUSED => PLAYING,
            _ => return,
        };
        // Toggle calls are serialized by SpeechState. A concurrent finish wins.
        let _ = self
            .0
            .compare_exchange(state, next, Ordering::SeqCst, Ordering::SeqCst);
    }

    pub fn session(&self) -> PlaybackSession<'_> {
        PlaybackSession {
            control: self,
            last_update: Instant::now(),
            elapsed: Duration::ZERO,
        }
    }
}

pub(super) struct PlaybackSession<'a> {
    control: &'a PlaybackControl,
    last_update: Instant,
    elapsed: Duration,
}

impl PlaybackSession<'_> {
    pub fn start(&self, channel: &tauri::ipc::Channel<SpeechProgress>, id: &str) {
        self.control.0.store(PLAYING, Ordering::SeqCst);
        progress(channel, id, "playing");
    }

    pub fn update(
        &mut self,
        player: &Player,
        monitor: &monitor::LocalMonitor,
        channel: &tauri::ipc::Channel<SpeechProgress>,
        id: &str,
    ) -> bool {
        // Charge the interval to the playback state the worker applied last time.
        let now = Instant::now();
        let was_paused = player.is_paused();
        if !was_paused {
            self.elapsed += now.duration_since(self.last_update);
        }
        self.last_update = now;
        let paused = self.control.0.load(Ordering::SeqCst) == PAUSED;
        if paused != was_paused {
            set_paused(player, paused);
            monitor.set_paused(paused);
            progress(
                channel,
                id,
                if paused { "playbackPaused" } else { "playing" },
            );
        }
        paused
    }

    pub fn elapsed(&self) -> Duration {
        self.elapsed
    }
}

impl Drop for PlaybackSession<'_> {
    fn drop(&mut self) {
        self.control.0.store(INACTIVE, Ordering::SeqCst);
    }
}

pub(super) fn set_paused(player: &Player, paused: bool) {
    if paused {
        player.pause();
    } else {
        player.play();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::num::{NonZeroU16, NonZeroU32};

    #[test]
    fn pause_holds_buffered_and_chunked_samples_and_ignores_stale_requests() {
        for block_size in [9_600, 3_200] {
            let state = SpeechState::default();
            let job = state.begin("current").unwrap();
            let (player, mut output) = Player::new();
            let monitor =
                monitor::LocalMonitor::new(None, job.active.monitor.clone(), "send".into());
            let channel = tauri::ipc::Channel::new(|_| Ok(()));
            let expected: Vec<_> = (1..=9_600).map(|sample| sample as f32 / 10_000.0).collect();
            for block in expected.chunks(block_size) {
                player.append(SamplesBuffer::new(
                    NonZeroU16::MIN,
                    NonZeroU32::new(32_000).unwrap(),
                    block.to_vec(),
                ));
            }
            let mut session = job.active.playback.session();
            state.toggle_playback(None).unwrap();
            assert!(!session.update(&player, &monitor, &channel, "current"));
            session.start(&channel, "current");
            state.toggle_playback(Some("old")).unwrap();
            assert!(!session.update(&player, &monitor, &channel, "current"));
            let mut actual = Vec::new();
            for samples in [1_010, 2_500] {
                actual.extend(
                    output
                        .by_ref()
                        .take(samples)
                        .filter(|&sample| sample != 0.0),
                );
                state.toggle_playback(Some("current")).unwrap();
                assert!(session.update(&player, &monitor, &channel, "current"));
                actual.extend(output.by_ref().take(320).filter(|&sample| sample != 0.0));
                let position = player.get_pos();
                let elapsed = session.elapsed();
                let silence: Vec<_> = output.by_ref().take(32_000).collect();
                assert_eq!(silence, vec![0.0; 32_000]);
                assert!(session.update(&player, &monitor, &channel, "current"));
                assert_eq!(session.elapsed(), elapsed);
                assert_eq!(player.get_pos(), position);
                assert!(!player.empty());
                state.toggle_playback(None).unwrap();
                assert!(!session.update(&player, &monitor, &channel, "current"));
            }
            let remaining = expected.len() - actual.len();
            actual.extend(output.filter(|&sample| sample != 0.0).take(remaining));
            assert_eq!(actual, expected);
        }
    }
}
