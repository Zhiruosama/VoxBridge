//! Explicit manual audition. Workspace test credential only; no Keychain or live-app changes.
use super::*;
use cpal::traits::{DeviceTrait, HostTrait};

#[tokio::test]
#[ignore = "manual: two paid MiniMax auditions played on the default physical output using workspace test key"]
async fn live_workspace_voice_audition_and_latency() {
    let device = cpal::default_host()
        .default_output_device()
        .expect("physical output required");
    let name = device.description().unwrap().name().to_string();
    assert!(
        !["blackhole", "parrot", "virtual", "aggregate"]
            .iter()
            .any(|word| name.to_lowercase().contains(word)),
        "audition requires a physical default output, never a call/virtual route"
    );
    let output = crate::platform::output_id(&device).unwrap();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let file = std::fs::read_to_string(root.join("密钥-不可提交/minimax.txt"))
        .expect("workspace test key file");
    let key = file
        .split_whitespace()
        .find_map(|word| {
            let start = word.find("sk-").or_else(|| word.find("eyJ"))?;
            let key: String = word[start..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
                .collect();
            (key.len() > 40).then_some(key)
        })
        .expect("test key marker");
    let directory = root.join("native/macos/.build/voice-audition");
    std::fs::create_dir_all(&directory).unwrap();
    println!("AUDITION_OUTPUT: {name}");
    let mut reports = Vec::new();
    for (language, text) in [
        (
            "en",
            "Hi, can you hear me clearly? I am testing the voice quality and response speed.",
        ),
        (
            "zh",
            "你好，这是语音生成测试。我们正在检查音色、停顿和响应速度。",
        ),
    ] {
        let profile:SpeechProfile=serde_json::from_value(json!({"id":"manual-workspace-audition","stage":"tts","adapter":"minimax_tts_ws","baseUrl":"wss://api.minimax.cn/ws/v1/t2a_v2","modelId":"speech-2.8-turbo","voice":"male-qn-qingse"})).unwrap();
        let token = CancellationToken::new();
        let _guard = token.clone().drop_guard();
        let started = Instant::now();
        let first_playing = Arc::new(Mutex::new(None));
        let playing = first_playing.clone();
        let channel = tauri::ipc::Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(body) = body {
                let event: Value = serde_json::from_str(&body).unwrap();
                if event["phase"] == "playing" {
                    *playing.lock().unwrap() = Some(started.elapsed().as_millis());
                }
            }
            Ok(())
        });
        let (net_tx, mut net_rx) = mpsc::channel::<Vec<u8>>(8);
        let (play_tx, play_rx) = mpsc::channel::<Vec<u8>>(8);
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let play_token = token.clone();
        let device = output.clone();
        let player = tauri::async_runtime::spawn_blocking(move || {
            play_stream(
                device,
                None,
                Arc::new(AtomicBool::new(false)),
                play_token,
                ready_tx,
                play_rx,
                channel,
                format!("audition-{language}"),
            )
        });
        ready_rx.await.unwrap().unwrap();
        let device_ready_ms = started.elapsed().as_millis();
        println!("AUDITION_BEGIN: {language}; model=speech-2.8-turbo; voice=male-qn-qingse");
        let receive = async {
            let mut pcm = Vec::new();
            let mut first = None;
            while let Some(block) = net_rx.recv().await {
                first.get_or_insert(started.elapsed().as_millis());
                assert!(pcm.len() + block.len() <= MAX_AUDIO);
                pcm.extend_from_slice(&block);
                if play_tx.send(block).await.is_err() {
                    return Err("audition output ended");
                }
            }
            drop(play_tx);
            Ok((pcm, first))
        };
        let synth = async {
            let result = synthesize_stream(
                &profile,
                endpoint(&profile).unwrap(),
                text,
                &key,
                &token,
                &net_tx,
            )
            .await;
            drop(net_tx);
            if result.is_err() {
                token.cancel();
            }
            (result, started.elapsed().as_millis())
        };
        let result = tokio::time::timeout(Duration::from_secs(45), async {
            tokio::join!(synth, receive, player)
        })
        .await;
        let ((generated, received_ms), recorded, played) = match result {
            Ok(value) => value,
            Err(_) => {
                token.cancel();
                panic!("audition timed out");
            }
        };
        generated.expect("MiniMax synthesis");
        played.unwrap().expect("physical output playback");
        let (pcm, first_pcm) = recorded.unwrap();
        assert!(pcm
            .as_chunks::<2>()
            .0
            .iter()
            .any(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]).abs_diff(0) > 32));
        let audio_seconds = pcm.len() as f64 / (f64::from(RATE) * 2.0);
        let path = directory.join(format!("{language}.wav"));
        let mut wav = Vec::with_capacity(44 + pcm.len());
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16_u32.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&RATE.to_le_bytes());
        wav.extend_from_slice(&(RATE * 2).to_le_bytes());
        wav.extend_from_slice(&2_u16.to_le_bytes());
        wav.extend_from_slice(&16_u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
        wav.extend_from_slice(&pcm);
        std::fs::write(&path, wav).unwrap();
        let report = json!({"language":language,"text":text,"model":"speech-2.8-turbo","voice":"male-qn-qingse","output":name,"deviceReadyMs":device_ready_ms,"firstPcmBlockMs":first_pcm,"firstPlaybackQueuedMs":*first_playing.lock().unwrap(),"streamReceiveCompleteMs":received_ms,"playbackCompleteMs":started.elapsed().as_millis(),"audioSeconds":audio_seconds,"file":path});
        println!("AUDITION_RESULT:{report}");
        reports.push(report);
    }
    std::fs::write(
        directory.join("results.json"),
        serde_json::to_vec_pretty(&reports).unwrap(),
    )
    .unwrap();
}
