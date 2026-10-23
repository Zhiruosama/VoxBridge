use super::*;
fn profile(url: &str) -> AsrProfile {
    AsrProfile {
        id: "provider-qwen-asr".into(),
        stage: "asr".into(),
        adapter: "qwen_dashscope_asr".into(),
        base_url: url.into(),
        model_id: "qwen-audio-3.0-asr-flash-streaming".into(),
    }
}
fn sentence(id: u64, text: &str, done: bool) -> Value {
    json!({"payload":{"output":{"sentence":{"sentence_id":id,"text":text,"sentence_end":done,"begin_time":120}}}})
}
#[test]
fn validates_realtime_endpoints_and_partial_revisions() {
    assert!(endpoint(&profile("wss://example.com/api-ws/v1/inference")).is_ok());
    assert!(endpoint(&profile("ws://127.0.0.1:1234")).is_ok());
    for url in [
        "ws://example.com/asr",
        "https://example.com",
        "wss://u:k@example.com",
        "wss://example.com/?k=secret",
        "wss://example.com/#",
    ] {
        assert!(endpoint(&profile(url)).is_err(), "{url}");
    }
    let mut results = Results::default();
    assert_eq!(
        results
            .accept(&sentence(1, "hello", false))
            .unwrap()
            .unwrap()
            .revision,
        1
    );
    assert!(results
        .accept(&sentence(1, "hello", false))
        .unwrap()
        .is_none());
    assert_eq!(
        results
            .accept(&sentence(1, "hello world", false))
            .unwrap()
            .unwrap()
            .revision,
        2
    );
    let final_text = results
        .accept(&sentence(1, "hello world", true))
        .unwrap()
        .unwrap();
    assert_eq!(final_text.revision, 3);
    assert!(final_text.final_text);
    assert!(results
        .accept(&sentence(1, "stale", false))
        .unwrap()
        .is_none());
    assert!(results
        .accept(&json!({"payload":{"output":{"sentence":{"heartbeat":true}}}}))
        .unwrap()
        .is_none());
    assert!(results
        .accept(&sentence(2, &"x".repeat(6001), true))
        .is_err());
}

#[tokio::test]
async fn mock_stream_waits_for_ready_and_delivers_revisions_before_finish() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("ws://{}", listener.local_addr().unwrap());
    let (partial_tx, partial_rx) = oneshot::channel();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
        let run: Value =
            serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(run["header"]["action"], "run-task");
        assert_eq!(run["payload"]["parameters"]["sample_rate"], 16000);
        let task = run["header"]["task_id"].as_str().unwrap();
        socket
            .send(Message::Text(
                json!({"header":{"task_id":task,"event":"task-started"}})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        let mut audio_received = false;
        let mut partial = Some(partial_tx);
        while let Some(Ok(message)) = socket.next().await {
            match message {
                Message::Binary(bytes) => {
                    assert_eq!(bytes.len(), 640);
                    audio_received = true;
                    for (text, done) in [("hello", false), ("hello world", true)] {
                        let mut value = sentence(1, text, done);
                        value["header"] = json!({"task_id":task,"event":"result-generated"});
                        socket
                            .send(Message::Text(value.to_string().into()))
                            .await
                            .unwrap();
                    }
                    partial.take().unwrap().send(()).unwrap();
                }
                Message::Ping(bytes) => socket.send(Message::Pong(bytes)).await.unwrap(),
                Message::Text(text) => {
                    let value: Value = serde_json::from_str(&text).unwrap();
                    assert!(audio_received);
                    assert_eq!(value["header"]["action"], "finish-task");
                    socket
                        .send(Message::Text(
                            json!({"header":{"task_id":task,"event":"task-finished"}})
                                .to_string()
                                .into(),
                        ))
                        .await
                        .unwrap();
                    break;
                }
                _ => {}
            }
        }
    });
    let (tx, rx) = mpsc::channel(2);
    let (ready_tx, ready_rx) = oneshot::channel();
    let producer = async move {
        ready_rx.await.unwrap();
        tx.send(vec![0; 640]).await.unwrap();
        partial_rx.await.unwrap();
        tokio::time::sleep(Duration::from_millis(30)).await;
        drop(tx);
    };
    let mut events = Vec::new();
    let token = CancellationToken::new();
    let config = profile(&address);
    let recognition = recognize_stream(&config, "test-key", &token, rx, ready_tx, |event| {
        events.push(event);
        Ok(())
    });
    let (result, ()) = tokio::join!(recognition, producer);
    result.unwrap();
    server.await.unwrap();
    assert_eq!(events.len(), 2);
    assert!(!events[0].final_text);
    assert!(events[1].final_text);
    assert_eq!(events[1].revision, 2);
}

#[tokio::test]
async fn cancelled_stream_does_not_connect_or_emit() {
    let (tx, rx) = mpsc::channel(1);
    let (ready, _) = oneshot::channel();
    let token = CancellationToken::new();
    token.cancel();
    recognize_stream(
        &profile("ws://127.0.0.1:1"),
        "secret",
        &token,
        rx,
        ready,
        |_| panic!("cancelled stream emitted"),
    )
    .await
    .unwrap();
    drop(tx);
}

#[tokio::test]
#[ignore = "manual: real Qwen ASR call using Keychain and generated English fixture"]
async fn live_qwen_realtime_generated_audio() {
    let wav = std::fs::read("../native/macos/.build/capture-sample.wav").unwrap();
    let data = wav.windows(4).position(|w| w == b"data").unwrap();
    let size = u32::from_le_bytes(wav[data + 4..data + 8].try_into().unwrap()) as usize;
    let audio = wav[data + 8..data + 8 + size].to_vec();
    let key = crate::credentials::read_for_test("provider-qwen-asr").unwrap();
    let config = profile("wss://maas.qianwenaiapi.com/api-ws/v1/inference");
    let (tx, rx) = mpsc::channel(10);
    let (ready_tx, ready_rx) = oneshot::channel();
    let producer = async move {
        ready_rx.await.unwrap();
        let mut padded = audio;
        padded.extend(vec![0; 32000]);
        for chunk in padded.chunks(640) {
            if tx.send(chunk.to_vec()).await.is_err() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    };
    let mut final_text = String::new();
    let mut revisions = 0;
    let token = CancellationToken::new();
    let recognition = recognize_stream(&config, &key, &token, rx, ready_tx, |sentence| {
        revisions += 1;
        if sentence.final_text {
            final_text.push_str(&sentence.text);
        }
        Ok(())
    });
    let (result, ()) = tokio::join!(recognition, producer);
    result.unwrap();
    assert!(
        final_text.to_lowercase().contains("meeting"),
        "final transcript missing expected fixture content"
    );
    eprintln!(
        "Qwen realtime passed: revisions={revisions}, final_chars={}",
        final_text.chars().count()
    );
}

#[tokio::test]
async fn active_stream_stops_without_late_events() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let config = profile(&format!("ws://{}", listener.local_addr().unwrap()));
    let token = CancellationToken::new();
    let cancelled = token.clone();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
        let run: Value =
            serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        socket
            .send(Message::Text(
                json!({"header":{"task_id":run["header"]["task_id"],"event":"task-started"}})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(1), async {
            while let Some(Ok(message)) = socket.next().await {
                if let Message::Ping(bytes) = message {
                    let _ = socket.send(Message::Pong(bytes)).await;
                }
            }
        })
        .await
        .expect("cancel must close socket");
    });
    let (_tx, rx) = mpsc::channel(1);
    let (ready_tx, ready_rx) = oneshot::channel();
    let stop = async move {
        ready_rx.await.unwrap();
        cancelled.cancel();
    };
    let recognition = recognize_stream(&config, "secret", &token, rx, ready_tx, |_| {
        panic!("late event")
    });
    let (result, ()) = tokio::join!(recognition, stop);
    result.unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn wrong_task_and_provider_failure_are_sanitized() {
    for wrong_id in [false, true] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config = profile(&format!("ws://{}", listener.local_addr().unwrap()));
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let run: Value =
                serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap())
                    .unwrap();
            let task = run["header"]["task_id"].as_str().unwrap();
            socket
                .send(Message::Text(
                    json!({"header":{"task_id":task,"event":"task-started"}})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
            socket.send(Message::Text(json!({"header":{"task_id":if wrong_id {"other-task"} else {task},"event":"task-failed","error_message":"secret-provider-detail"}}).to_string().into())).await.unwrap();
        });
        let (_tx, rx) = mpsc::channel(1);
        let (ready_tx, _ready_rx) = oneshot::channel();
        let error = recognize_stream(
            &config,
            "secret",
            &CancellationToken::new(),
            rx,
            ready_tx,
            |_| panic!("unexpected event"),
        )
        .await
        .unwrap_err();
        assert!(!error.contains("secret"));
        assert!(error.contains(if wrong_id {
            "标识不匹配"
        } else {
            "任务失败"
        }));
        server.await.unwrap();
    }
}

#[tokio::test]
async fn reconnects_after_dropped_socket_without_replaying_audio() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let config = profile(&format!("ws://{}", listener.local_addr().unwrap()));
    let server = tokio::spawn(async move {
        for generation in 0..2 {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let run: Value =
                serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap())
                    .unwrap();
            let task = run["header"]["task_id"].as_str().unwrap();
            socket
                .send(Message::Text(
                    json!({"header":{"task_id":task,"event":"task-started"}})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
            loop {
                match socket.next().await.unwrap().unwrap() {
                    Message::Binary(bytes) => {
                        assert_eq!(
                            bytes[0], generation,
                            "only fresh audio must be sent on each attempt"
                        );
                        let mut value = sentence(
                            1,
                            if generation == 0 {
                                "partial before drop"
                            } else {
                                "new final"
                            },
                            generation == 1,
                        );
                        value["header"] = json!({"task_id":task,"event":"result-generated"});
                        socket
                            .send(Message::Text(value.to_string().into()))
                            .await
                            .unwrap();
                        if generation == 0 {
                            break;
                        }
                    }
                    Message::Ping(bytes) => socket.send(Message::Pong(bytes)).await.unwrap(),
                    Message::Text(text) => {
                        let value: Value = serde_json::from_str(&text).unwrap();
                        assert_eq!(value["header"]["action"], "finish-task");
                        socket
                            .send(Message::Text(
                                json!({"header":{"task_id":task,"event":"task-finished"}})
                                    .to_string()
                                    .into(),
                            ))
                            .await
                            .unwrap();
                        break;
                    }
                    _ => {}
                }
            }
            // Drop transport without a close handshake on the first attempt.
        }
    });
    let token = CancellationToken::new();
    let events = std::sync::Mutex::new(Vec::new());
    let mut retries = 0;
    crate::recovery::supervise(
        &token,
        |generation| {
            let events = &events;
            let config = &config;
            let token = &token;
            async move {
                let (tx, rx) = mpsc::channel(1);
                let (ready_tx, ready_rx) = oneshot::channel();
                let producer = async move {
                    if ready_rx.await.is_ok() {
                        let _ = tx.send(vec![generation as u8; 640]).await;
                        tokio::time::sleep(Duration::from_millis(20)).await;
                    }
                };
                let recognition =
                    recognize_stream(config, "test-key", token, rx, ready_tx, |sentence| {
                        events.lock().unwrap().push((generation, sentence));
                        Ok(())
                    });
                let (result, ()) = tokio::join!(recognition, producer);
                result
            }
        },
        |_, _, _| {
            retries += 1;
            Ok(())
        },
    )
    .await
    .unwrap();
    server.await.unwrap();
    assert_eq!(retries, 1);
    let events = events.lock().unwrap();
    assert_eq!(events.len(), 2);
    assert!(!events[0].1.final_text);
    assert_eq!(events[1].0, 1);
    assert!(events[1].1.final_text);
}
