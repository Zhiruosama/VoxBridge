//! Manual only: opt-in provider smoke test. Credentials arrive on stdin, never as CLI arguments.
//! Uses production request/decoder paths; does not open audio hardware or route into calls.
use crate::{credentials, providers, speech};
use rodio::Source;
use serde::Deserialize;
use std::{
    io::{self, Write},
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

#[derive(Deserialize)]
struct Keys {
    deepseek: String,
    minimax: String,
}

#[tokio::test]
#[ignore = "manual paid API test; provide credentials as one JSON line on stdin"]
async fn live_provider_smoke() {
    println!("LIVE_READY: optional credential JSON on stdin; empty input uses OS credential store");
    io::stdout().flush().unwrap();
    let mut line = String::new();
    io::stdin().read_line(&mut line).unwrap();
    if !line.trim().is_empty() {
        let keys: Keys =
            serde_json::from_str(&line).expect("expected credential JSON; input not logged");
        credentials::set_credential("provider-deepseek-flash".into(), keys.deepseek)
            .expect("save translation credential");
        credentials::set_credential("provider-minimax-cn".into(), keys.minimax)
            .expect("save speech credential");
    }
    line.clear();
    println!("CREDENTIALS: using OS credential store for provider presets");

    let cases = [
        (
            "Please do not cancel the meeting. It starts at 10 tomorrow morning.",
            "英语",
            "简体中文",
        ),
        (
            "请把更新后的文档发给 Alex，预算是 250 美元。",
            "简体中文",
            "英语",
        ),
    ];
    let mut translated = None;
    let mut failures = 0;
    for (index, (text, source, target)) in cases.into_iter().enumerate() {
        let started = Instant::now();
        match providers::request_translation(
            url::Url::parse("https://api.deepseek.com/chat/completions").unwrap(),
            credentials::read("provider-deepseek-flash").unwrap(),
            "deepseek-flash",
            text,
            source,
            target,
            Some(providers::Thinking::Disabled),
        )
        .await
        {
            Ok(result) => {
                println!(
                    "TRANSLATION_{}: {} ms | {}",
                    index + 1,
                    started.elapsed().as_millis(),
                    result
                );
                if index == 0 {
                    translated = Some(result);
                }
            }
            Err(error) => {
                failures += 1;
                println!("TRANSLATION_{}: FAILED | {}", index + 1, error);
            }
        }
    }
    let profile: speech::SpeechProfile = serde_json::from_value(serde_json::json!({
        "id":"provider-minimax-cn", "stage":"tts", "adapter":"minimax_tts_ws",
        "baseUrl":"wss://api.minimax.cn/ws/v1/t2a_v2", "modelId":"speech-2.8-turbo", "voice":"male-qn-qingse"
    })).unwrap();
    let text = translated
        .as_deref()
        .unwrap_or("你好，这是 VoxBridge 语音合成测试。");
    let started = Instant::now();
    let token = CancellationToken::new();
    match speech::synthesize_cancellable(
        &profile,
        speech::endpoint(&profile).unwrap(),
        text,
        &credentials::read("provider-minimax-cn").unwrap(),
        &token,
    )
    .await
    {
        Ok(audio) => {
            let bytes = audio.len();
            let folder =
                std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/live-validation");
            std::fs::create_dir_all(&folder).unwrap();
            std::fs::write(folder.join("minimax-preview.mp3"), &audio).unwrap();
            let decoded = speech::decode(audio.clone(), &token).expect("real MP3 must decode");
            let rate = decoded.sample_rate();
            let channels = decoded.channels();
            let samples: Vec<f32> = decoded.collect();
            assert!(
                samples.iter().any(|sample| sample.abs() > 0.001),
                "decoded audio is silent"
            );
            let duration = samples.len() as f64 / rate as f64 / channels as f64;
            println!(
                "TTS: {} ms | {} bytes | {} Hz | {} channels | {:.3} seconds | non-silent",
                started.elapsed().as_millis(),
                bytes,
                rate,
                channels,
                duration
            );
            println!("AUDIO: target/live-validation/minimax-preview.mp3 (not tracked)");
        }
        Err(error) => {
            failures += 1;
            println!("TTS: FAILED | {}", error);
        }
    }
    // Cancel before sending text, so this check cannot start a second synthesis.
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    let stopped = tokio::time::timeout(
        Duration::from_secs(1),
        speech::synthesize_cancellable(
            &profile,
            speech::endpoint(&profile).unwrap(),
            "cancelled",
            &credentials::read("provider-minimax-cn").unwrap(),
            &cancelled,
        ),
    )
    .await
    .unwrap();
    assert!(stopped.is_err());
    println!("EARLY_CANCEL: passed (no synthesis submitted)");
    assert_eq!(
        failures, 0,
        "one or more live providers failed; see sanitized results"
    );
}
