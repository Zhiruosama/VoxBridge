//! Explicitly invoked hardware fixtures. Never run by the default test suite.
use super::{native, CaptureSource};
use std::{
    io::{BufRead, Write},
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

pub(super) struct SyntheticPlayer {
    child: Child,
    replies: mpsc::Receiver<String>,
    pub source: CaptureSource,
}

impl Drop for SyntheticPlayer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl SyntheticPlayer {
    pub fn start() -> Self {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "capture::test_audio::synthetic_audio_child",
                "--ignored",
                "--nocapture",
            ])
            .env("VOXBRIDGE_SYNTHETIC_CHILD", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("start controlled audio child");
        let stdout = child.stdout.take().unwrap();
        let (sender, replies) = mpsc::channel();
        std::thread::spawn(move || {
            for line in std::io::BufReader::new(stdout)
                .lines()
                .map_while(Result::ok)
            {
                if line.starts_with("SYNTHETIC_") && sender.send(line).is_err() {
                    break;
                }
            }
        });
        // Own the child before any fallible setup so a failed handshake cannot leak playback.
        let mut player = Self {
            source: CaptureSource {
                pid: child.id() as i32,
                bundle_id: String::new(),
            },
            child,
            replies,
        };
        player.wait("SYNTHETIC_READY");
        let started = Instant::now();
        loop {
            if let Some(source) = native::sources()
                .unwrap()
                .into_iter()
                .find(|s| s.pid == player.source.pid)
            {
                player.source = source;
                break;
            }
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "silent playback process not registered"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        player
    }

    fn wait(&self, expected: &str) {
        assert_eq!(
            self.replies
                .recv_timeout(Duration::from_secs(20))
                .expect("audio child timed out"),
            expected
        );
    }

    pub fn command(&mut self, command: &str) {
        let stdin = self.child.stdin.as_mut().unwrap();
        writeln!(stdin, "{command}").unwrap();
        stdin.flush().unwrap();
        self.wait("SYNTHETIC_ACK");
    }
}

fn measure(
    capture: &native::Capture,
    reader: &mut rtrb::Consumer<crate::pcm::Frame>,
    duration: Duration,
) -> (u64, f32) {
    let started = Instant::now();
    let mut frames = 0;
    let mut peak = 0.0_f32;
    while started.elapsed() < duration {
        assert!(!capture.failed());
        while let Ok(frame) = reader.pop() {
            frames += 1;
            peak = peak.max(frame.samples[0].abs()).max(frame.samples[1].abs());
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    (frames, peak)
}

#[test]
#[ignore = "manual hardware test: controlled tones, target isolation and 20 native start/stop cycles; no network"]
fn live_capture_isolates_process_and_restarts() {
    let mut target = SyntheticPlayer::start();
    let mut other = SyntheticPlayer::start();
    let other_token = tokio_util::sync::CancellationToken::new();
    let (other_writer, mut other_reader, _) = crate::pcm::channel(192_000);
    let other_capture = native::Capture::start(&other.source, other_writer, &other_token).unwrap();
    for cycle in 0..20 {
        other.command("tone");
        let token = tokio_util::sync::CancellationToken::new();
        let (writer, mut reader, _) = crate::pcm::channel(192_000);
        let capture = native::Capture::start(&target.source, writer, &token).unwrap();
        let silent = measure(&capture, &mut reader, Duration::from_millis(350));
        assert!(silent.0 > 0, "no frames in cycle {cycle}");
        assert!(
            silent.1 < 0.00001,
            "other process leaked into target: {}",
            silent.1
        );
        while other_reader.pop().is_ok() {}
        let control = measure(
            &other_capture,
            &mut other_reader,
            Duration::from_millis(150),
        );
        assert!(
            control.1 > 0.01,
            "isolation control must actually be audible"
        );
        target.command("tone");
        let audible = measure(&capture, &mut reader, Duration::from_millis(500));
        assert!(audible.1 > 0.01, "missing target audio in cycle {cycle}");
        target.command("silence");
        // Drain output/capture latency before verifying silence.
        measure(&capture, &mut reader, Duration::from_millis(300));
        let quiet = measure(&capture, &mut reader, Duration::from_millis(350));
        assert!(
            quiet.0 > 0 && quiet.1 < 0.00001,
            "target did not return to silence"
        );
        token.cancel();
        drop(capture);
        // A destroyed IOProc must never publish frames again.
        while reader.pop().is_ok() {}
        std::thread::sleep(Duration::from_millis(50));
        assert!(reader.pop().is_err(), "callbacks continued after teardown");
        println!(
            "SYNTHETIC_RESTART: cycle {} passed; isolated, audible, silent, stopped",
            cycle + 1
        );
    }
}

#[test]
#[ignore = "internal hardware subprocess; only launched by explicit synthetic audio tests"]
fn synthetic_audio_child() {
    use rodio::{DeviceSinkBuilder, Player, Source};
    assert_eq!(
        std::env::var("VOXBRIDGE_SYNTHETIC_CHILD").as_deref(),
        Ok("1")
    );
    // A last-resort bound in addition to the parent's RAII cleanup.
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(120));
        std::process::exit(1);
    });
    let stream = DeviceSinkBuilder::open_default_sink().expect("open synthetic output");
    let sink = Player::connect_new(stream.mixer());
    println!("SYNTHETIC_READY");
    std::io::stdout().flush().unwrap();
    for line in std::io::stdin().lock().lines() {
        sink.stop();
        match line.unwrap().as_str() {
            "speech" => {
                let audio = std::fs::read(
                    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("../native/macos/.build/capture-sample.wav"),
                )
                .expect("generate synthetic speech fixture first");
                let source =
                    crate::speech::decode(audio, &tokio_util::sync::CancellationToken::new())
                        .unwrap();
                sink.append(source.amplify(0.25));
            }
            "tone" => sink.append(
                rodio::source::SineWave::new(997.0)
                    .amplify(0.04)
                    .take_duration(Duration::from_secs(30)),
            ),
            "silence" => {}
            _ => panic!("unknown synthetic player command"),
        }
        println!("SYNTHETIC_ACK");
        std::io::stdout().flush().unwrap();
    }
}
