use super::*;
use std::io::{Read, Write};

fn profile(base_url: String) -> AsrProfile {
    AsrProfile {
        id: "test-asr".into(),
        stage: "asr".into(),
        adapter: "qwen_chat_asr".into(),
        base_url,
        model_id: "test-model".into(),
    }
}

pub(crate) fn wav() -> Vec<u8> {
    let data = vec![0_u8; 3200];
    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&16000_u32.to_le_bytes());
    wav.extend_from_slice(&32000_u32.to_le_bytes());
    wav.extend_from_slice(&2_u16.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
    wav.extend_from_slice(&data);
    wav
}

#[test]
fn endpoint_preserves_prefix_and_rejects_unsafe_addresses() {
    assert_eq!(
        endpoint(&profile("https://example.com/compatible-mode/v1/".into()))
            .unwrap()
            .as_str(),
        "https://example.com/compatible-mode/v1/chat/completions"
    );
    for address in [
        "http://example.com/v1",
        "https://user:secret@example.com/v1",
        "https://example.com/v1?",
        "https://example.com/v1#",
        "https://example.com/v1/chat/completions",
    ] {
        assert!(endpoint(&profile(address.into())).is_err());
    }
    assert!(endpoint(&profile("http://[::1]:9000/v1".into())).is_ok());
    let mut invalid = profile("https://example.com/v1".into());
    invalid.stage = "tts".into();
    assert!(endpoint(&invalid).is_err());
}

#[test]
fn wav_validation_rejects_wrong_format_truncation_and_empty_samples() {
    let original = wav();
    assert_eq!(validate_wav(&original).unwrap(), 0.1);
    let mut wrong_rate = original.clone();
    wrong_rate[24..28].copy_from_slice(&48000_u32.to_le_bytes());
    assert!(validate_wav(&wrong_rate).is_err());
    let mut wrong_channels = original.clone();
    wrong_channels[22..24].copy_from_slice(&2_u16.to_le_bytes());
    assert!(validate_wav(&wrong_channels).is_err());
    assert!(validate_wav(&original[..original.len() - 1]).is_err());
    assert!(validate_wav(&vec![0; MAX_WAV + 1]).is_err());
    assert!(validate_wav(&[]).is_err());
    let mut wrong_order = original[..12].to_vec();
    wrong_order.extend_from_slice(&original[36..]);
    wrong_order.extend_from_slice(&original[12..36]);
    assert!(validate_wav(&wrong_order).is_err());
}

#[test]
fn responses_are_complete_bounded_and_do_not_echo_provider_errors() {
    let ok = br#"{"choices":[{"finish_reason":"stop","message":{"content":"hello"}}]}"#;
    assert_eq!(parse_response(ok, 0.1).unwrap().text, "hello");
    let empty = br#"{"choices":[{"finish_reason":"stop","message":{"content":""}}]}"#;
    assert!(parse_response(empty, 0.1).unwrap().text.is_empty());
    for response in [
        br#"{"choices":[{"finish_reason":"length","message":{"content":"private"}}]}"#.as_slice(),
        br#"{"error":{"message":"private-secret"}}"#.as_slice(),
        br#"{"choices":[]}"#.as_slice(),
    ] {
        let error = parse_response(response, 0.1).err().unwrap();
        assert!(!error.contains("private"));
    }
    for status in [400, 401, 403, 404, 429, 503] {
        assert!(status_error(status).contains(&status.to_string()));
    }
}

fn server(status: &str, body: Vec<u8>) -> (String, std::thread::JoinHandle<Vec<u8>>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!(
        "http://{}/compatible-mode/v1",
        listener.local_addr().unwrap()
    );
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
                            .and_then(|length| length.parse::<usize>().ok())
                    })
                    .unwrap();
                if received.len() >= end + 4 + length {
                    break;
                }
            }
        }
        write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n", body.len()).unwrap();
        stream.write_all(&body).unwrap();
        received
    });
    (address, task)
}

#[tokio::test]
async fn request_uses_exact_audio_data_uri_and_model() {
    let (address, server) = server(
        "200 OK",
        br#"{"choices":[{"finish_reason":"stop","message":{"content":"recognized"}}]}"#.to_vec(),
    );
    let audio = wav();
    let result = recognize(
        &profile(address),
        &audio,
        "test-key",
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(result.text, "recognized");
    let received = server.join().unwrap();
    let end = received
        .windows(4)
        .position(|bytes| bytes == b"\r\n\r\n")
        .unwrap();
    assert!(String::from_utf8_lossy(&received[..end])
        .starts_with("POST /compatible-mode/v1/chat/completions"));
    let body: Value = serde_json::from_slice(&received[end + 4..]).unwrap();
    assert_eq!(body["model"], "test-model");
    assert_eq!(body["stream"], false);
    assert!(body.get("asr_options").is_none());
    let data = body
        .pointer("/messages/0/content/0/input_audio/data")
        .unwrap()
        .as_str()
        .unwrap();
    assert_eq!(
        STANDARD
            .decode(data.strip_prefix("data:audio/wav;base64,").unwrap())
            .unwrap(),
        audio
    );
}

#[tokio::test]
async fn authentication_failure_does_not_echo_upstream_message() {
    let (address, server) = server(
        "401 Unauthorized",
        br#"{"error":"private-secret"}"#.to_vec(),
    );
    let error = recognize(
        &profile(address),
        &wav(),
        "test-key",
        &CancellationToken::new(),
    )
    .await
    .err()
    .unwrap();
    assert!(error.contains("401"));
    assert!(!error.contains("private"));
    server.join().unwrap();
}

#[tokio::test]
async fn cancellation_before_and_during_network_wait_is_respected() {
    let token = CancellationToken::new();
    token.cancel();
    let error = recognize(
        &profile("http://127.0.0.1:1/v1".into()),
        &wav(),
        "test-key",
        &token,
    )
    .await
    .err()
    .unwrap();
    assert_eq!(error, STOPPED);
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}/v1", listener.local_addr().unwrap());
    let (accepted_tx, accepted_rx) = tokio::sync::oneshot::channel();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut byte = [0];
        stream.read_exact(&mut byte).unwrap();
        accepted_tx.send(()).unwrap();
        while stream.read(&mut byte).unwrap_or(0) > 0 {}
    });
    let token = CancellationToken::new();
    let cancelled = token.clone();
    let request =
        tokio::spawn(
            async move { recognize(&profile(address), &wav(), "test-key", &cancelled).await },
        );
    accepted_rx.await.unwrap();
    token.cancel();
    assert_eq!(request.await.unwrap().err().unwrap(), STOPPED);
    server.join().unwrap();
}

#[test]
fn task_registry_rejects_busy_and_old_stop_cannot_cancel_new_job() {
    let state = AsrState::default();
    state.cancel("early").unwrap();
    assert!(state.begin("early").is_err());
    let old = state.begin("old").unwrap();
    assert!(state.begin("busy").is_err());
    state.cancel("old").unwrap();
    assert!(old.token.is_cancelled());
    drop(old);
    let current = state.begin("new").unwrap();
    state.cancel("old").unwrap();
    assert!(!current.token.is_cancelled());
    drop(current);
    for n in 0..100 {
        state.cancel(&format!("missing-{n}")).unwrap();
    }
    assert_eq!(state.0.lock().unwrap().cancelled.len(), 64);
}

#[tokio::test]
#[ignore = "manual paid Qwen ASR test; key only arrives via stdin and is stored in Keychain"]
async fn live_qwen_asr_short_audio() {
    use std::time::Instant;
    let mut key = String::new();
    std::io::stdin()
        .read_line(&mut key)
        .expect("credential stdin unavailable");
    if key.trim().is_empty() {
        key = crate::credentials::read_for_test("provider-qwen-asr")
            .expect("save ASR credential before live validation");
    } else {
        crate::credentials::set_for_test("provider-qwen-asr".into(), key.trim().into())
            .expect("save ASR credential");
    }
    let audio = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../native/macos/.build/asr-sample.wav"),
    )
    .expect("generate the authorized synthetic WAV sample first");
    validate_wav(&audio).expect("synthetic WAV format");
    let mut profile = profile("https://maas.qianwenaiapi.com/compatible-mode/v1".into());
    let mut passed = false;
    for model in ["qwen-audio-3.0-asr-flash", "qwen3-asr-flash"] {
        profile.model_id = model.into();
        let started = Instant::now();
        match recognize(&profile, &audio, key.trim(), &CancellationToken::new()).await {
            Ok(transcript) => {
                let normalized = transcript.text.to_lowercase();
                assert!(
                    normalized.contains("speech") && normalized.contains("test"),
                    "synthetic speech was not recognized"
                );
                println!(
                    "ASR_VALIDATED: {model} | {} ms | {:.2} audio seconds | transcript: {}",
                    started.elapsed().as_millis(),
                    transcript.audio_seconds,
                    transcript.text
                );
                passed = true;
                break;
            }
            Err(error) => {
                println!("ASR_REJECTED: {model} | {error}");
                if !error.contains("404") && !error.contains("400") {
                    break;
                }
            }
        }
    }
    assert!(
        passed,
        "Qwen ASR live validation failed; credential and upstream response not logged"
    );
}
