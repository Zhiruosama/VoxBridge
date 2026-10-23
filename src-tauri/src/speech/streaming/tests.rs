use super::*;

#[test]
fn pcm_preserves_little_endian_samples_across_arbitrary_network_boundaries() {
    let bytes: Vec<_> = [i16::MIN, -12345, 0, 12345, i16::MAX]
        .into_iter()
        .flat_map(i16::to_le_bytes)
        .collect();
    for size in 1..=bytes.len() {
        let mut decoder = PcmDecoder::default();
        let decoded: Vec<_> = bytes
            .chunks(size)
            .flat_map(|part| decoder.push(part).unwrap())
            .collect();
        decoder.finish().unwrap();
        assert_eq!(
            decoded,
            vec![
                -1.0,
                -12345.0 / 32768.0,
                0.0,
                12345.0 / 32768.0,
                32767.0 / 32768.0
            ]
        );
    }
}

#[test]
fn pcm_rejects_empty_truncated_and_overlong_audio_and_inconsistent_metadata() {
    let mut decoder = PcmDecoder::default();
    assert!(decoder.finish().is_err());
    decoder.push(&[7]).unwrap();
    assert!(decoder.finish().is_err());
    decoder.samples = RATE as usize * 120;
    assert!(decoder.push(&[0]).is_err());
    validate_metadata(&json!({})).unwrap();
    validate_metadata(
        &json!({"extra_info":{"audio_format":"pcm","audio_sample_rate":32000,"audio_channel":1}}),
    )
    .unwrap();
    for meta in [
        json!({"audio_format":"mp3"}),
        json!({"audio_sample_rate":24000}),
        json!({"audio_channel":2}),
    ] {
        assert!(validate_metadata(&json!({"extra_info":meta})).is_err());
    }
}

async fn mock_socket() -> (
    SpeechProfile,
    tokio::task::JoinHandle<tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>>,
) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let profile = super::super::tests::profile(
        "minimax_tts_ws",
        format!("ws://{}", listener.local_addr().unwrap()),
    );
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        ws.send(Message::Text(
            json!({"event":"connected_success"}).to_string().into(),
        ))
        .await
        .unwrap();
        let start: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(start["audio_setting"]["format"], "pcm");
        assert_eq!(start["audio_setting"]["sample_rate"], 32000);
        ws.send(Message::Text(
            json!({"event":"task_started"}).to_string().into(),
        ))
        .await
        .unwrap();
        let text: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(text["event"], "task_continue");
        ws
    });
    (profile, server)
}

#[tokio::test]
async fn stream_delivers_audio_before_final_and_preserves_all_bytes() {
    let (profile, server) = mock_socket().await;
    let (sender, mut receiver) = mpsc::channel(1);
    let token = CancellationToken::new();
    let (consumed_tx, consumed_rx) = tokio::sync::oneshot::channel();
    let serve = async {
        let mut ws = server.await.unwrap();
        ws.send(Message::Text(
            json!({"data":{"audio":"0080ff"},"is_final":false})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
        // Final is withheld until the consumer receives an earlier chunk.
        consumed_rx.await.unwrap();
        ws.send(Message::Text(
            json!({"data":{"audio":"7f0000"},"is_final":true})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
        let finish: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(finish["event"], "task_finish");
        let _ = ws.close(None).await;
    };
    let consume = async {
        let first = receiver.recv().await.unwrap();
        assert_eq!(first, vec![0, 128, 255]);
        consumed_tx.send(()).unwrap();
        let second = receiver.recv().await.unwrap();
        [first, second].concat()
    };
    let (result, _, bytes) = tokio::join!(
        synthesize_stream(
            &profile,
            endpoint(&profile).unwrap(),
            "hello",
            "mock-key",
            &token,
            &sender
        ),
        serve,
        consume
    );
    result.unwrap();
    assert_eq!(bytes, vec![0, 128, 255, 127, 0, 0]);
}

#[tokio::test]
async fn cancellation_interrupts_a_full_playback_queue() {
    let (profile, server) = mock_socket().await;
    let (sender, _receiver) = mpsc::channel(1);
    let token = CancellationToken::new();
    let cancel = token.clone();
    let serve = async {
        let mut ws = server.await.unwrap();
        ws.send(Message::Text(
            json!({"data":{"audio":hex::encode(vec![0_u8;6400*4])}})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        cancel.cancel();
    };
    let (result, _) = tokio::time::timeout(Duration::from_secs(3), async {
        tokio::join!(
            synthesize_stream(
                &profile,
                endpoint(&profile).unwrap(),
                "hello",
                "mock-key",
                &token,
                &sender
            ),
            serve
        )
    })
    .await
    .unwrap();
    assert_eq!(result.unwrap_err(), STOPPED);
    assert_eq!(
        sender.capacity(),
        0,
        "the test must actually saturate the queue"
    );
}

#[tokio::test]
async fn malformed_or_mismatched_stream_fails_without_echoing_upstream_content() {
    let (profile, server) = mock_socket().await;
    let (sender, _receiver) = mpsc::channel(1);
    let token = CancellationToken::new();
    let serve = async {
        let mut ws = server.await.unwrap();
        ws.send(Message::Text(
            json!({"extra_info":{"audio_format":"private-secret-mp3"},"data":{"audio":"abcd"}})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    };
    let (result, _) = tokio::join!(
        synthesize_stream(
            &profile,
            endpoint(&profile).unwrap(),
            "hello",
            "mock-key",
            &token,
            &sender
        ),
        serve
    );
    let error = result.unwrap_err();
    assert!(error.contains("PCM"));
    assert!(!error.contains("private-secret"));
}

#[cfg(target_os = "macos")]
#[tokio::test]
#[ignore = "manual paid MiniMax PCM streaming and real default physical output; two short requests including cancellation"]
async fn live_minimax_streaming_physical_output_and_stop() {
    use cpal::traits::{DeviceTrait, HostTrait};
    let device = cpal::default_host()
        .default_output_device()
        .expect("connect physical output first");
    let name = device.description().unwrap().name().to_string();
    assert!(
        !["blackhole", "parrot", "virtual", "aggregate"]
            .iter()
            .any(|s| name.to_lowercase().contains(s)),
        "select a physical default output first"
    );
    let id = crate::platform::output_id(&device).unwrap();
    println!("LIVE_OUTPUT: {name}; no default fallback in production routing");
    for cancel in [false, true] {
        let profile:SpeechProfile=serde_json::from_value(json!({"id":"provider-minimax-cn","stage":"tts","adapter":"minimax_tts_ws","baseUrl":"wss://api.minimax.cn/ws/v1/t2a_v2","modelId":"speech-2.8-turbo","voice":"male-qn-qingse"})).unwrap();
        let state = SpeechState::default();
        let job = state
            .begin(if cancel { "live-stop" } else { "live-complete" })
            .unwrap();
        let token = job.token.clone();
        let observed = Arc::new(Mutex::new(Vec::new()));
        let phases = observed.clone();
        let started = Instant::now();
        let channel = tauri::ipc::Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(body) = body {
                let value: Value = serde_json::from_str(&body).unwrap();
                let phase = value["phase"].as_str().unwrap().to_string();
                if phase == "playing" {
                    println!("LIVE_FIRST_PLAYBACK: {} ms", started.elapsed().as_millis());
                    if cancel {
                        let stop = token.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_millis(250));
                            stop.cancel();
                        });
                    }
                }
                phases.lock().unwrap().push(phase);
            }
            Ok(())
        });
        let permit = AudioGate::new().0.acquire_owned().await.unwrap();
        let text = if cancel {
            "这是停止测试，听到声音后会立即停止，后面的内容不应该继续播放。"
        } else {
            "你好，这是流式语音播放测试。"
        };
        let result = speak_streaming(
            profile,
            url::Url::parse("wss://api.minimax.cn/ws/v1/t2a_v2").unwrap(),
            text.into(),
            id.clone(),
            crate::credentials::read_for_test("provider-minimax-cn").unwrap(),
            job,
            permit,
            channel,
        )
        .await;
        let phases = observed.lock().unwrap();
        assert!(phases.iter().any(|p| p == "playing"));
        if cancel {
            assert_eq!(result.unwrap_err(), STOPPED);
            assert_eq!(phases.last().unwrap(), "stopped");
        } else {
            result.unwrap();
            assert_eq!(phases.last().unwrap(), "completed");
        }
        println!(
            "LIVE_STREAM_CASE: cancel={cancel} | {} ms | {phases:?}",
            started.elapsed().as_millis()
        );
    }
}
