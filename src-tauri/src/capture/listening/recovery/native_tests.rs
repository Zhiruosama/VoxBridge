use super::*;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;

#[tokio::test]
#[ignore = "manual: silent generated-process capture and local mock ASR/translation; no paid services"]
async fn live_native_capture_reconnects_and_releases_old_attempt() {
    let player = crate::capture::test_audio::SyntheticPlayer::start();
    let asr = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let asr_url = format!("ws://{}", asr.local_addr().unwrap());
    let translation_server = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let translation_url = format!("http://{}", translation_server.local_addr().unwrap());
    let translator = tokio::spawn(async move {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (mut stream, _) = translation_server.accept().await.unwrap();
        let mut request = vec![0; 8192];
        let mut received = Vec::new();
        loop {
            let size = stream.read(&mut request).await.unwrap();
            assert!(size > 0);
            received.extend_from_slice(&request[..size]);
            if let Some(position) = received.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&received[..position]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|v| v.trim().parse::<usize>().ok())
                    })
                    .unwrap();
                if received.len() >= position + 4 + length {
                    break;
                }
            }
        }
        let body = json!({"choices":[{"finish_reason":"stop","message":{"content":"新连接"}}]})
            .to_string();
        let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
        stream.write_all(response.as_bytes()).await.unwrap();
    });
    let server = tokio::spawn(async move {
        for generation in 0..2 {
            let (stream, _) = asr.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let run: Value =
                serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap())
                    .unwrap();
            let task = &run["header"]["task_id"];
            socket
                .send(Message::Text(
                    json!({"header":{"task_id":task,"event":"task-started"}})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
            loop {
                match socket.next().await {
                    Some(Ok(Message::Binary(_))) => {
                        socket.send(Message::Text(json!({"header":{"task_id":task,"event":"result-generated"},"payload":{"output":{"sentence":{"sentence_id":1,"text":if generation==0 {"old partial"}else{"new final"},"sentence_end":generation==1,"begin_time":0}}}}).to_string().into())).await.unwrap();
                        break;
                    }
                    Some(Ok(Message::Ping(bytes))) => {
                        socket.send(Message::Pong(bytes)).await.unwrap()
                    }
                    _ => panic!("native PCM stream ended early"),
                }
            }
            if generation == 1 {
                while let Some(Ok(_)) = socket.next().await {}
            }
        }
    });
    let request:ListeningRequest=serde_json::from_value(json!({"source":player.source,"sessionId":"native-recovery","asrProfile":{"id":"test-asr","stage":"asr","adapter":"qwen_dashscope_asr","baseUrl":asr_url,"modelId":"test"},"translationProfile":{"id":"test-translation","stage":"translation","adapter":"openai_chat_completions","baseUrl":translation_url,"modelId":"test"},"sourceLanguage":"英语","targetLanguage":"简体中文"})).unwrap();
    let registry = crate::providers::Requests::default();
    let translation = registry
        .reserve_listening(
            request.translation_profile.clone(),
            &request.session_id,
            "test-key".into(),
        )
        .unwrap();
    let stop = CancellationToken::new();
    let cancel = stop.clone();
    let _guard = stop.clone().drop_guard();
    let events = Arc::new(Mutex::new(Vec::new()));
    let observed = events.clone();
    let channel = tauri::ipc::Channel::new(move |body| {
        if let tauri::ipc::InvokeResponseBody::Json(body) = body {
            let event: Value = serde_json::from_str(&body).unwrap();
            if event["type"] == "translation" {
                cancel.cancel();
            }
            observed.lock().unwrap().push(event);
        }
        Ok(())
    });
    let asr_stop = CancellationToken::new();
    let finish = CancellationToken::new();
    let result = run(
        &request,
        &channel,
        &stop,
        &finish,
        &asr_stop,
        &translation,
        "test-key",
    );
    let watchdog = async {
        tokio::select! {_=stop.cancelled()=>{},_=tokio::time::sleep(Duration::from_secs(35))=>stop.cancel()}
    };
    let (result, ()) = tokio::join!(result, watchdog);
    result.unwrap();
    server.await.unwrap();
    translator.await.unwrap();
    let events = events.lock().unwrap();
    assert_eq!(
        events
            .iter()
            .filter(|event| event["type"] == "recovering")
            .count(),
        1
    );
    let partial = events
        .iter()
        .find(|event| event["type"] == "transcript" && event["generation"] == 0)
        .unwrap();
    let final_text = events
        .iter()
        .find(|event| event["type"] == "transcript" && event["generation"] == 1)
        .unwrap();
    assert_ne!(partial["segmentId"], final_text["segmentId"]);
    assert!(final_text["startMs"].as_u64().unwrap() >= 1000);
    assert!(events
        .iter()
        .any(|event| event["type"] == "translation" && event["generation"] == 1));
    println!("LIVE_NATIVE_RECOVERY: two capture lifetimes, fresh ASR connection, unique subtitle IDs, final translation passed");
}
