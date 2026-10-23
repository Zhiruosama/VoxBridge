use super::*;
use std::io::{BufRead, BufReader, Read, Write};

#[test]
fn rejects_explanatory_prose_and_source_echo_but_preserves_names() {
    let explanation="The phrase \"dollar house\" is already in English, so no translation is needed. If you intended to provide Chinese source text, please send it and I will translate it into English.";
    assert!(!valid_translation("dollar house.", explanation, "简体中文"));
    assert!(!valid_translation(
        "Are you pushing it?",
        "Are you pushing it?",
        "简体中文"
    ));
    assert!(valid_translation(
        "Fifteen million dollar house.",
        "一千五百万美元的房子。",
        "简体中文"
    ));
    assert!(valid_translation(
        "Google Chrome",
        "Google Chrome",
        "简体中文"
    ));
}

fn sequence(
    replies: Vec<&'static str>,
) -> (url::Url, std::thread::JoinHandle<Vec<serde_json::Value>>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = endpoint(&format!("http://{}/v1", listener.local_addr().unwrap())).unwrap();
    let server = std::thread::spawn(move || {
        let mut requests = Vec::new();
        for reply in replies {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let mut length = 0;
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
            }
            let mut bytes = vec![0; length];
            reader.read_exact(&mut bytes).unwrap();
            requests.push(serde_json::from_slice(&bytes).unwrap());
            let body=serde_json::json!({"choices":[{"finish_reason":"stop","message":{"content":reply}}]}).to_string();
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        }
        requests
    });
    (url, server)
}

#[tokio::test]
async fn wrong_hint_and_source_echo_retry_into_target_language_without_displaying_commentary() {
    let (url, server) = sequence(vec!["Are you pushing it?", "你是不是太过分了？"]);
    let result = request_translation(
        url,
        "test-key".into(),
        "flash-test",
        "Are you pushing it?",
        "简体中文",
        "简体中文",
        None,
    )
    .await
    .unwrap();
    assert_eq!(result, "你是不是太过分了？");
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[0]["messages"][0]["content"]
        .as_str()
        .unwrap()
        .contains("Detect its actual language automatically"));
    assert!(requests[1]["messages"][0]["content"]
        .as_str()
        .unwrap()
        .contains("Output ONLY the translation"));
}

#[tokio::test]
async fn repeated_wrong_language_returns_only_a_sanitized_error() {
    let (url, server) = sequence(vec!["Are you pushing it?", "Are you pushing it?"]);
    let result = request_translation(
        url,
        "test-key".into(),
        "flash-test",
        "Are you pushing it?",
        "自动识别",
        "简体中文",
        None,
    )
    .await;
    assert_eq!(result.unwrap_err(), INVALID_TRANSLATION);
    assert_eq!(server.join().unwrap().len(), 2);
}

#[tokio::test]
#[ignore = "manual: five short DeepSeek flash requests using the workspace-provided test key; no Keychain access"]
async fn live_flash_translates_screenshot_captions_into_chinese() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("密钥-不可提交/deepseek.txt");
    let file = std::fs::read_to_string(path).expect("workspace-provided test key file");
    let start = file.find("sk-").expect("test key marker");
    let key: String = file[start..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let url = endpoint("https://api.deepseek.com").unwrap();
    let examples = [
        "Pretty fun house to live in, but of course we're all here to see the richest of the rich.",
        "And that's why up next we have the fifteen million dollar house.",
        "Are you pushing it?",
        "Oh my God, geez, man.",
        "I don't belong here.",
    ];
    let mut results = Vec::new();
    for source in examples {
        let started = std::time::Instant::now();
        let result = request_translation(
            url.clone(),
            key.clone(),
            "deepseek-flash",
            source,
            "自动识别",
            "简体中文",
            Some(Thinking::Disabled),
        )
        .await
        .expect("valid target-language translation");
        assert!(valid_translation(source, &result, "简体中文"));
        assert_ne!(result, source);
        results.push(serde_json::json!({"source":source,"translation":result,"elapsedMs":started.elapsed().as_millis()}));
    }
    println!(
        "LIVE_FLASH_CAPTIONS:{}",
        serde_json::to_string(&results).unwrap()
    );
}

#[tokio::test]
async fn transport_reuses_one_tcp_connection_without_reusing_authorization() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = endpoint(&format!("http://{}/v1", listener.local_addr().unwrap())).unwrap();
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut reader = BufReader::new(socket.try_clone().unwrap());
        for expected in ["Bearer fixture-one", "Bearer fixture-two"] {
            let mut line = String::new();
            reader
                .read_line(&mut line)
                .expect("both requests must use the same TCP connection");
            assert!(line.starts_with("POST /v1/chat/completions "));
            let mut length = 0;
            let mut auth = String::new();
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                if let Some((name, value)) = line.split_once(':') {
                    if name.eq_ignore_ascii_case("authorization") {
                        auth = value.trim().into();
                    }
                }
            }
            assert_eq!(auth, expected);
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let response = r#"{"choices":[{"message":{"content":"你好"},"finish_reason":"stop"}]}"#;
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
        }
    });
    for secret in ["fixture-one", "fixture-two"] {
        assert_eq!(
            request_translation(
                url.clone(),
                secret.into(),
                "model",
                "hello",
                "英语",
                "简体中文",
                None
            )
            .await
            .unwrap(),
            "你好"
        );
    }
    server.join().unwrap();
}
