use super::*;
use std::io::{Read, Write};

const MP3: &[u8] = include_bytes!("fixtures/tone.mp3");
#[test]
fn websocket_http_200_explains_region_and_does_not_echo_response_text() {
    let url = url::Url::parse("wss://api.minimax.io/ws/v1/t2a_v2").unwrap();
    let missing_upgrade = websocket_handshake_failure(&url, 200, None);
    assert!(missing_upgrade.contains("HTTP 200"));
    assert!(missing_upgrade.contains("未建立 WebSocket"));
    assert!(missing_upgrade.contains("api.minimax.cn"));
    let auth = websocket_handshake_failure(
        &url,
        200,
        Some(br#"{"base_resp":{"status_code":2049,"status_msg":"private-key-do-not-display"}}"#),
    );
    assert!(auth.contains("认证"));
    assert!(auth.contains("2049"));
    assert!(!auth.contains("private-key"));
    let upstream = provider_status(503);
    assert!(upstream.contains("HTTP 503"));
    assert!(upstream.contains("暂时不可用"));
}
#[test]
fn minimax_errors_distinguish_balance_auth_and_voice_without_echoing_provider_text() {
    for (code, expected) in [
        (1004, "认证"),
        (1008, "余额"),
        (2054, "音色"),
        (2022, "模型"),
    ] {
        let error = minimax_failure(
            &json!({"base_resp":{"status_code":code,"status_msg":"private-secret"}}),
        );
        assert!(error.contains(expected));
        assert!(error.contains(&code.to_string()));
        assert!(!error.contains("private-secret"));
    }
}
pub(super) fn profile(adapter: &str, base_url: String) -> SpeechProfile {
    SpeechProfile {
        language: None,
        speed: 1.0,
        id: "test-profile".into(),
        stage: "tts".into(),
        adapter: adapter.into(),
        base_url,
        model_id: "test-model".into(),
        voice: "test-voice".into(),
    }
}

#[test]
fn endpoint_and_routing_reject_unsafe_configuration() {
    let mut p = profile("openai_audio_speech", "https://example.com/v1/".into());
    assert_eq!(
        endpoint(&p).unwrap().as_str(),
        "https://example.com/v1/audio/speech"
    );
    for address in [
        "http://example.com/v1",
        "https://secret@example.com/v1",
        "https://example.com/v1?key=secret",
        "https://example.com/v1/audio/speech",
    ] {
        p.base_url = address.into();
        assert!(endpoint(&p).is_err());
    }
    p.base_url = "http://[::1]:9000/v1".into();
    assert!(endpoint(&p).is_ok());
    p.voice.clear();
    assert!(endpoint(&p).is_err());
    let routing = Routing {
        preview_device_id: "speakers".into(),
        send_device_id: "virtual".into(),
        monitor_enabled: false,
    };
    assert_eq!(routing.destination(&Route::Preview).unwrap(), "speakers");
    assert_eq!(routing.destination(&Route::Send).unwrap(), "virtual");
    assert!(Routing {
        send_device_id: "speakers".into(),
        ..routing
    }
    .destination(&Route::Send)
    .is_err());
}

#[test]
fn registry_handles_early_cancel_busy_and_stale_stop() {
    let state = SpeechState::default();
    state.cancel("early".into()).unwrap();
    assert!(state.begin("early").is_err());
    let old = state.begin("old").unwrap();
    assert!(state.begin("new").is_err());
    state.cancel("old".into()).unwrap();
    assert!(old.token.is_cancelled());
    drop(old);
    let new = state.begin("new").unwrap();
    state.cancel("old".into()).unwrap();
    assert!(!new.token.is_cancelled());
    drop(new);
    for n in 0..100 {
        state.cancel(format!("missing-{n}")).unwrap();
    }
    assert_eq!(state.0.lock().unwrap().cancelled.len(), 64);
    assert!(state.begin("after").is_ok());
}

#[test]
fn final_outcome_preserves_cancellation_and_real_failure_priority() {
    for (synthesized, played, expected, phase) in [
        (Ok(()), Ok(()), Ok(()), "completed"),
        (Ok(()), Err(STOPPED.into()), Err(STOPPED.into()), "stopped"),
        (Err(STOPPED.into()), Ok(()), Err(STOPPED.into()), "stopped"),
        (
            Err(STOPPED.into()),
            Err(STOPPED.into()),
            Err(STOPPED.into()),
            "stopped",
        ),
        (
            Err("provider failed".into()),
            Err(STOPPED.into()),
            Err("provider failed".into()),
            "failed",
        ),
        (
            Err(STOPPED.into()),
            Err("device failed".into()),
            Err("device failed".into()),
            "failed",
        ),
        (
            Err("provider failed".into()),
            Err("device failed".into()),
            Err("provider failed".into()),
            "failed",
        ),
        (
            Ok(()),
            Err("worker failed".into()),
            Err("worker failed".into()),
            "failed",
        ),
    ] {
        assert_eq!(speech_outcome(synthesized, played), (expected, phase));
    }
}

#[tokio::test]
async fn cancel_after_synthesis_while_waiting_for_playback_reports_stopped() {
    let state = SpeechState::default();
    let job = state.begin("playing").unwrap();
    let token = job.token.clone();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let worker = tokio::spawn(async move {
        ready_tx.send(()).unwrap();
        token.cancelled().await;
        Err(STOPPED.to_string())
    });
    ready_rx.await.unwrap();
    assert!(!job.token.is_cancelled());
    state.cancel("playing".into()).unwrap();
    assert_eq!(
        speech_outcome(Ok(()), worker.await.unwrap()),
        (Err(STOPPED.into()), "stopped")
    );
    drop(job);
    assert!(state.begin("next").is_ok());
}

#[test]
fn decode_generated_mp3_and_reject_invalid_audio_and_cancel() {
    let token = CancellationToken::new();
    let source = decode(MP3.to_vec(), &token).unwrap();
    assert_eq!(source.channels().get(), 1);
    assert_eq!(source.sample_rate().get(), 32_000);
    let samples: Vec<f32> = source.collect();
    assert!(samples.len() >= 3200 && samples.len() < 10000);
    assert!(samples.iter().any(|sample| sample.abs() > 0.01));
    assert!(decode(b"not audio".to_vec(), &token).is_err());
    token.cancel();
    assert!(decode(MP3.to_vec(), &token).is_err());
    let mut bytes = vec![0; MAX_AUDIO - 1];
    assert!(append_audio(&mut bytes, &[1, 2]).is_err());
    assert_eq!(bytes.len(), MAX_AUDIO - 1);
}

#[test]
fn streaming_mp3_with_unfinalized_frame_count_decodes_without_gapless_underflow() {
    let mut audio = MP3.to_vec();
    let info = audio
        .windows(4)
        .position(|bytes| bytes == b"Info" || bytes == b"Xing")
        .unwrap();
    // Reproduce a live TTS stream header: unknown final frame count, valid encoder padding.
    audio[info + 8..info + 12].copy_from_slice(&0_u32.to_be_bytes());
    let samples: Vec<f32> = decode(audio, &CancellationToken::new()).unwrap().collect();
    assert!(samples.len() > 3200);
    assert!(samples.iter().any(|sample| sample.abs() > 0.01));
}

fn http_server(status: &str, body: Vec<u8>) -> (String, std::thread::JoinHandle<String>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}/v1", listener.local_addr().unwrap());
    let status = status.to_string();
    let task = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut received = Vec::new();
        let mut chunk = [0; 4096];
        loop {
            let size = stream.read(&mut chunk).unwrap();
            assert!(size > 0);
            received.extend_from_slice(&chunk[..size]);
            if let Some(end) = received.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&received[..end]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|s| s.parse::<usize>().ok())
                    })
                    .unwrap();
                if received.len() >= end + 4 + length {
                    break;
                }
            }
        }
        write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: audio/mpeg\r\nConnection: close\r\n\r\n", body.len()).unwrap();
        stream.write_all(&body).unwrap();
        String::from_utf8(received).unwrap()
    });
    (address, task)
}

#[tokio::test]
async fn openai_http_sends_exact_profile_and_returns_decodable_audio() {
    let (address, server) = http_server("200 OK", MP3.to_vec());
    let mut p = profile("openai_audio_speech", address);
    p.speed = 1.25;
    let audio = synthesize(&p, endpoint(&p).unwrap(), "你好", "mock-key")
        .await
        .unwrap();
    assert_eq!(audio, MP3);
    assert!(decode(audio, &CancellationToken::new()).is_ok());
    let request = server.join().unwrap();
    assert!(request.starts_with("POST /v1/audio/speech "));
    assert!(request
        .to_lowercase()
        .contains("authorization: bearer mock-key"));
    let payload: Value = serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(
        payload,
        json!({"model":"test-model","voice":"test-voice","input":"你好","response_format":"mp3","speed":1.25})
    );
}

#[tokio::test]
async fn authentication_error_does_not_echo_provider_body_or_secret() {
    let (address, server) = http_server(
        "401 Unauthorized",
        b"mock-key private provider error".to_vec(),
    );
    let p = profile("openai_audio_speech", address);
    let error = synthesize(&p, endpoint(&p).unwrap(), "hello", "mock-key")
        .await
        .unwrap_err();
    assert!(error.contains("认证"));
    assert!(!error.contains("mock-key"));
    assert!(!error.contains("private"));
    server.join().unwrap();
}

#[tokio::test]
async fn cancellation_drops_a_waiting_connection() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let p = profile(
        "openai_audio_speech",
        format!("http://{}", listener.local_addr().unwrap()),
    );
    let token = CancellationToken::new();
    let cancel = token.clone();
    let stop = async {
        let (_socket, _) = listener.accept().await.unwrap();
        cancel.cancel();
        tokio::time::sleep(Duration::from_millis(100)).await;
    };
    let call = synthesize_cancellable(&p, endpoint(&p).unwrap(), "hello", "mock-key", &token);
    let (result, _) = tokio::join!(call, stop);
    assert_eq!(result.unwrap_err(), STOPPED);
}

#[tokio::test]
async fn minimax_websocket_orders_messages_and_combines_audio_chunks() {
    for (language, boost) in [
        ("日语", "Japanese"),
        ("粤语", "Chinese,Yue"),
        ("芬兰语", "Finnish"),
        ("俄语", "Russian"),
        ("德语", "German"),
    ] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut p = profile(
            "minimax_tts_ws",
            format!("ws://{}", listener.local_addr().unwrap()),
        );
        p.language = Some(language.into());
        p.speed = 1.35;
        let server = async {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            ws.send(Message::Text(
                json!({"event":"connected_success","base_resp":{"status_code":0}})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
            let start: Value =
                serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
            assert_eq!(start["event"], "task_start");
            assert_eq!(start["language_boost"], boost);
            assert_eq!(start["voice_setting"]["voice_id"], "test-voice");
            assert_eq!(start["voice_setting"]["speed"], 1.35);
            assert_eq!(start["audio_setting"]["format"], "mp3");
            ws.send(Message::Text(
                json!({"event":"task_started"}).to_string().into(),
            ))
            .await
            .unwrap();
            let text: Value =
                serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
            assert_eq!(text["text"], "hello");
            for (index, chunk) in MP3.chunks(MP3.len().div_ceil(2)).enumerate() {
                ws.send(Message::Text(
                    json!({"data":{"audio":hex::encode(chunk)},"is_final":index==1})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
            }
            let finish: Value =
                serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
            assert_eq!(finish["event"], "task_finish");
            let _ = ws.close(None).await;
        };
        let (audio, _) = tokio::join!(
            synthesize(&p, endpoint(&p).unwrap(), "hello", "mock-key"),
            server
        );
        assert_eq!(audio.unwrap(), MP3);
    }
}

#[tokio::test]
async fn minimax_rejects_failed_handshake_without_echoing_message() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let p = profile(
        "minimax_tts_ws",
        format!("ws://{}", listener.local_addr().unwrap()),
    );
    let server = async {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        ws.send(Message::Text(
            json!({"event":"task_failed","base_resp":{"status_code":1004,"status_msg":"mock-key"}})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    };
    let (result, _) = tokio::join!(
        synthesize(&p, endpoint(&p).unwrap(), "hello", "mock-key"),
        server
    );
    let error = result.unwrap_err();
    assert!(!error.contains("mock-key"));
}

#[test]
fn monitoring_is_live_request_scoped_and_early_overrides_are_bounded() {
    let state = SpeechState::default();
    state.set_monitoring("first", false).unwrap();
    let first = state.begin_monitor("first", true).unwrap();
    assert!(!first.monitor.load(Ordering::SeqCst));
    state.set_monitoring("first", true).unwrap();
    assert!(first.monitor.load(Ordering::SeqCst));
    assert!(!first.token.is_cancelled());
    drop(first);
    let next = state.begin_monitor("next", false).unwrap();
    state.set_monitoring("first", true).unwrap();
    assert!(!next.monitor.load(Ordering::SeqCst));
    for n in 0..100 {
        state.set_monitoring(&format!("missing-{n}"), true).unwrap();
    }
    assert_eq!(state.0.lock().unwrap().monitor_overrides.len(), 64);
    state.stop_all();
    assert!(next.token.is_cancelled());
}

#[test]
fn monitor_requires_a_separate_preview_device_only_for_send_route() {
    let mut routing: Routing = serde_json::from_value(
        json!({"previewDeviceId":"","sendDeviceId":"virtual","monitorEnabled":true}),
    )
    .unwrap();
    assert!(routing.destination(&Route::Send).is_err());
    routing.monitor_enabled = false;
    assert_eq!(routing.destination(&Route::Send).unwrap(), "virtual");
}

#[test]
fn speed_defaults_and_bounds_are_checked_before_connecting() {
    let old: SpeechProfile = serde_json::from_value(json!({"id":"old","stage":"tts","adapter":"minimax_tts_ws","baseUrl":"wss://example.com","modelId":"m","voice":"v"})).unwrap();
    assert_eq!(old.speed, 1.0);
    let mut p = profile("minimax_tts_ws", "wss://example.com".into());
    for speed in [0.49, 2.01, f64::NAN, f64::INFINITY] {
        p.speed = speed;
        assert!(endpoint(&p).is_err());
    }
    for speed in [0.5, 1.0, 1.35, 2.0] {
        p.speed = speed;
        assert!(endpoint(&p).is_ok());
    }
}
