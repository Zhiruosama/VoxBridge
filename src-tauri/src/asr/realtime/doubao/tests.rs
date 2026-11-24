use super::*;
use tokio::net::TcpListener;

fn server_frame(value: Value, sequence: i32) -> Message {
    let Message::Binary(frame) = encode(1, sequence, value.to_string().as_bytes()).unwrap() else {
        unreachable!()
    };
    let mut frame = frame.to_vec();
    frame[1] |= 0x80;
    Message::Binary(frame.into())
}

fn utterance(text: &str, start: u64, end: u64, definite: bool) -> Value {
    json!({"text": text, "start_time": start, "end_time": end, "definite": definite})
}

#[test]
fn rejects_truncated_and_oversized_responses() {
    let Message::Binary(frame) = server_frame(json!({ "result": {} }), 1) else {
        unreachable!()
    };
    for end in 0..frame.len() {
        assert!(decode(&frame[..end]).is_err());
    }
    let Message::Binary(frame) = server_frame(json!({ "oversized": "x".repeat(MAX_RESPONSE) }), 1)
    else {
        unreachable!()
    };
    assert!(decode(&frame).is_err());
}

#[tokio::test]
async fn sends_audio_and_emits_only_new_previews_and_sentence_finals() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        use tokio_tungstenite::tungstenite::handshake::server;
        let (socket, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_hdr_async(
            socket,
            |request: &server::Request, response: server::Response| {
                assert_eq!(request.headers()["x-api-key"], "fixture-key");
                assert_eq!(
                    request.headers()["x-api-resource-id"],
                    "volc.seedasr.sauc.duration"
                );
                assert!(uuid::Uuid::parse_str(
                    request.headers()["x-api-request-id"].to_str().unwrap()
                )
                .is_ok());
                assert!(!request.headers().contains_key("authorization"));
                Ok(response)
            },
        )
        .await
        .unwrap();
        let first = socket.next().await.unwrap().unwrap().into_data();
        assert_eq!(&first[..8], &[0x11, 0x11, 0x11, 0, 0, 0, 0, 1]);
        let mut start = String::new();
        GzDecoder::new(&first[12..])
            .read_to_string(&mut start)
            .unwrap();
        let request = serde_json::from_str::<Value>(&start).unwrap();
        assert_eq!(request["request"]["enable_nonstream"], true);
        assert_eq!(request["request"]["result_type"], "single");
        socket
            .send(server_frame(json!({"result":{}}), 1))
            .await
            .unwrap();

        let packet = socket.next().await.unwrap().unwrap().into_data();
        assert_eq!(&packet[..8], &[0x11, 0x21, 0x01, 0, 0, 0, 0, 2]);
        let mut audio = Vec::new();
        GzDecoder::new(&packet[12..])
            .read_to_end(&mut audio)
            .unwrap();
        assert_eq!(audio, vec![17; 3200]);
        let preview = utterance("It's fifteen.", 0, 1000, false);
        let final_text = utterance("It's fifty.", 0, 1030, true);
        for (i, row) in [preview.clone(), preview, final_text.clone(), final_text]
            .into_iter()
            .enumerate()
        {
            socket
                .send(server_frame(
                    json!({"result":{"utterances":[row]}}),
                    i as i32 + 2,
                ))
                .await
                .unwrap();
        }

        let end = socket.next().await.unwrap().unwrap().into_data();
        assert_eq!(&end[..8], &[0x11, 0x23, 0x01, 0, 0xff, 0xff, 0xff, 0xfd]);
        let mut tail = Vec::new();
        GzDecoder::new(&end[12..]).read_to_end(&mut tail).unwrap();
        assert_eq!(tail, vec![17; 640]);
        socket
            .send(server_frame(
                json!({"result":{"utterances":[utterance("走吧。", 1100, 1300, true)]}}),
                -6,
            ))
            .await
            .unwrap();
    });
    let profile = AsrProfile {
        id: "fixture".into(),
        stage: "asr".into(),
        adapter: "doubao_realtime_asr".into(),
        base_url: format!("ws://{address}"),
        model_id: "volc.seedasr.sauc.duration".into(),
    };
    let (send, audio) = mpsc::channel(8);
    let (ready, wait) = oneshot::channel();
    let writer = async {
        wait.await.unwrap();
        for _ in 0..6 {
            send.send(vec![17; 640]).await.unwrap();
        }
        drop(send);
    };
    let mut received = Vec::new();
    let token = CancellationToken::new();
    let recognition = recognize(
        &profile,
        "自动识别",
        "fixture-key",
        &token,
        audio,
        ready,
        |sentence| {
            received.push((
                sentence.id,
                sentence.revision,
                sentence.final_text,
                sentence.text,
            ));
            Ok(())
        },
    );
    let ((), result) = tokio::join!(writer, recognition);
    result.unwrap();
    server.await.unwrap();
    assert_eq!(
        received,
        vec![
            (1, 1, false, "It's fifteen.".into()),
            (1, 2, true, "It's fifty.".into()),
            (2, 1, true, "走吧。".into()),
        ]
    );
}
