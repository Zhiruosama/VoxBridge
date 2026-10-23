use super::*;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::tungstenite::Message;

#[tokio::test]
async fn clean_audio_eof_waits_for_provider_final_then_translates_tail_without_pause_timer() {
    run_fixture(true).await;
}

#[tokio::test]
async fn clean_audio_eof_does_not_turn_an_unconfirmed_hypothesis_into_a_translation() {
    run_fixture(false).await;
}

async fn run_fixture(send_final: bool) {
    let ws = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ws_url = format!("ws://{}", ws.local_addr().unwrap());
    let http = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}", http.local_addr().unwrap());
    let http_server = tokio::spawn(async move {
        let (mut stream, _) = http.accept().await.unwrap();
        let mut bytes = Vec::new();
        let body_start = loop {
            let mut block = [0; 1024];
            let count = stream.read(&mut block).await.unwrap();
            assert!(count > 0);
            bytes.extend_from_slice(&block[..count]);
            if let Some(index) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                break index + 4;
            }
            assert!(bytes.len() < 32000);
        };
        let headers = std::str::from_utf8(&bytes[..body_start]).unwrap();
        let length: usize = headers
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .map(|length| length.trim().parse().unwrap())
            })
            .unwrap();
        while bytes.len() < body_start + length {
            let mut block = [0; 1024];
            let count = stream.read(&mut block).await.unwrap();
            assert!(count > 0);
            bytes.extend_from_slice(&block[..count]);
        }
        let payload: Value =
            serde_json::from_slice(&bytes[body_start..body_start + length]).unwrap();
        assert_eq!(
            payload["messages"][1]["content"],
            "The meeting has not been cancelled"
        );
        let body =
            json!({"choices":[{"message":{"content":"会议没有取消。"},"finish_reason":"stop"}]})
                .to_string();
        let reply=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
        stream.write_all(reply.as_bytes()).await.unwrap();
    });
    let server = tokio::spawn(async move {
        let (stream, _) = ws.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
        let command: Value =
            serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        let id = command["header"]["task_id"].as_str().unwrap();
        socket
            .send(Message::Text(
                json!({"header":{"event":"task-started","task_id":id}})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        let mut audio = false;
        while let Some(Ok(message)) = socket.next().await {
            match message {
                Message::Binary(bytes) => {
                    assert_eq!(bytes.len(), 640);
                    audio = true;
                    let partial = json!({"header":{"event":"result-generated","task_id":id},"payload":{"output":{"sentence":{"sentence_id":1,"text":"The meeting has not been cancelled","sentence_end":false,"begin_time":0}}}});
                    socket
                        .send(Message::Text(partial.to_string().into()))
                        .await
                        .unwrap();
                }
                Message::Ping(bytes) => socket.send(Message::Pong(bytes)).await.unwrap(),
                Message::Text(command) => {
                    let command: Value = serde_json::from_str(&command).unwrap();
                    assert_eq!(command["header"]["action"], "finish-task");
                    assert!(audio);
                    if send_final {
                        let final_text = json!({"header":{"event":"result-generated","task_id":id},"payload":{"output":{"sentence":{"sentence_id":1,"text":"The meeting has not been cancelled","sentence_end":true,"begin_time":0}}}});
                        socket
                            .send(Message::Text(final_text.to_string().into()))
                            .await
                            .unwrap();
                    }
                    socket
                        .send(Message::Text(
                            json!({"header":{"event":"task-finished","task_id":id}})
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
    let request:ListeningRequest=serde_json::from_value(json!({"source":{"pid":999,"bundleId":"fixture"},"sessionId":"drain-fixture","asrProfile":{"id":"fixture-asr","stage":"asr","adapter":"qwen_dashscope_asr","baseUrl":ws_url,"modelId":"fixture"},"translationProfile":{"id":"fixture-translation","stage":"translation","adapter":"openai_chat_completions","baseUrl":base_url,"modelId":"fixture"},"sourceLanguage":"英语","targetLanguage":"简体中文"})).unwrap();
    let registry = crate::providers::Requests::default();
    let translation = registry
        .reserve_listening(
            request.translation_profile.clone(),
            &request.session_id,
            "fixture-key".into(),
        )
        .unwrap();
    let token = CancellationToken::new();
    let asr_stop = CancellationToken::new();
    let (tx, rx) = mpsc::channel(10);
    let (ready_tx, ready_rx) = oneshot::channel();
    let (partial_tx, partial_rx) = oneshot::channel();
    let partial_tx = Mutex::new(Some(partial_tx));
    let observed = Arc::new(Mutex::new(Vec::<Value>::new()));
    let events = observed.clone();
    let channel = tauri::ipc::Channel::new(move |body| {
        if let tauri::ipc::InvokeResponseBody::Json(body) = body {
            let event: Value = serde_json::from_str(&body).unwrap();
            if event["type"] == "transcript" && event["final"] == false {
                if let Some(sender) = partial_tx.lock().unwrap().take() {
                    let _ = sender.send(());
                }
            }
            events.lock().unwrap().push(event);
        }
        Ok(())
    });
    let input = async {
        ready_rx.await.unwrap();
        tx.send(vec![0; 640]).await.unwrap();
        partial_rx.await.unwrap();
        drop(tx); // Stop capture; finish-task must still receive and drain the provider's tail.
    };
    let skipped = AtomicU64::new(0);
    let worker = process_stream(
        &request,
        &channel,
        &token,
        &asr_stop,
        &translation,
        "fixture-key",
        rx,
        ready_tx,
        &skipped,
    );
    let (result, ()) = tokio::time::timeout(Duration::from_secs(3), async {
        tokio::join!(worker, input)
    })
    .await
    .expect("pipeline must drain and close all queues");
    result.unwrap();
    server.await.unwrap();
    if send_final {
        http_server.await.unwrap();
    } else {
        http_server.abort();
    }
    let events = observed.lock().unwrap();
    let translated: Vec<_> = events
        .iter()
        .filter(|e| e["type"] == "translation")
        .collect();
    let finals: Vec<_> = events
        .iter()
        .filter(|e| e["type"] == "transcript" && e["final"] == true)
        .collect();
    if send_final {
        assert_eq!(translated.len(), 1);
        assert_eq!(finals.len(), 1);
        assert_eq!(translated[0]["text"], "会议没有取消。");
        assert_eq!(translated[0]["segmentId"], finals[0]["segmentId"]);
        assert_eq!(translated[0]["revision"], finals[0]["revision"]);
    } else {
        assert!(translated.is_empty());
        assert!(finals.is_empty());
    }
}
