use super::*;
use cpal::traits::{DeviceTrait, HostTrait};
use serde_json::{json, Value};
use std::sync::Mutex;

#[tokio::test]
#[ignore = "manual: generated-process capture plus real Qwen/DeepSeek and MiniMax physical output"]
async fn live_duplex_capture_survives_stopping_speech_output() {
    crate::credentials::read_for_test("provider-deepseek-flash")
        .expect("explicit legacy fixture setup");
    crate::credentials::read_for_test("provider-minimax-cn")
        .expect("explicit legacy fixture setup");

    let mut player = crate::capture::test_audio::SyntheticPlayer::start();
    let device = cpal::default_host()
        .default_output_device()
        .expect("physical output");
    let name = device.description().unwrap().name().to_string();
    assert!(
        !["blackhole", "parrot", "virtual", "aggregate"]
            .iter()
            .any(|s| name.to_lowercase().contains(s)),
        "manual test requires physical headphones"
    );
    let device_id = crate::platform::output_id(&device).unwrap();
    let request: ListeningRequest = serde_json::from_value(json!({
            "source":player.source,"sessionId":"live-duplex",
            "asrProfile":{"id":"provider-qwen-realtime","stage":"asr","adapter":"qwen_dashscope_asr","baseUrl":"wss://maas.qianwenaiapi.com/api-ws/v1/inference","modelId":"qwen-audio-3.0-asr-flash-streaming"},
            "translationProfile":{"id":"provider-deepseek-flash","stage":"translation","adapter":"openai_chat_completions","baseUrl":"https://api.deepseek.com","modelId":"deepseek-flash","thinking":"disabled"},
            "sourceLanguage":"英语","targetLanguage":"简体中文"
        })).unwrap();
    let token = CancellationToken::new();
    let _guard = token.clone().drop_guard();
    let stop = token.clone();
    let (ready_tx, ready_rx) = oneshot::channel();
    let ready_tx = Mutex::new(Some(ready_tx));
    let events = Arc::new(Mutex::new(Vec::<Value>::new()));
    let observed = events.clone();
    let channel = tauri::ipc::Channel::new(move |body| {
        if let tauri::ipc::InvokeResponseBody::Json(body) = body {
            let event: Value = serde_json::from_str(&body).unwrap();
            if event["type"] == "progress" && event["frames"].as_u64().unwrap_or(0) > 0 {
                if let Some(ready) = ready_tx.lock().unwrap().take() {
                    let _ = ready.send(());
                }
            }
            if event["type"] == "recovering" {
                println!("DUPLEX_RECOVERY: {}", event["reason"]);
            }
            if event["type"] == "transcript" && event["final"] == true {
                println!("DUPLEX_GENERATED_FINAL: {}", event["text"]);
            }
            if event["type"] == "translation" {
                stop.cancel();
            }
            observed.lock().unwrap().push(event);
        }
        Ok(())
    });
    let translations = crate::providers::Requests::default();
    let translation = translations
        .listening_session(request.translation_profile.clone(), &request.session_id)
        .await
        .unwrap();
    let key = crate::credentials::read_for_test("provider-qwen-realtime").unwrap();
    let speech_state = crate::speech::SpeechState::default();
    let gate = crate::speech::AudioGate::new();
    let (playing_tx, playing_rx) = oneshot::channel();
    let playing_tx = Mutex::new(Some(playing_tx));
    let phases = Arc::new(Mutex::new(Vec::new()));
    let observed_phases = phases.clone();
    let progress = tauri::ipc::Channel::new(move |body| {
        if let tauri::ipc::InvokeResponseBody::Json(body) = body {
            let value: Value = serde_json::from_str(&body).unwrap();
            let phase = value["phase"].as_str().unwrap().to_string();
            if phase == "playing" {
                if let Some(playing) = playing_tx.lock().unwrap().take() {
                    let _ = playing.send(());
                }
            }
            observed_phases.lock().unwrap().push(phase);
        }
        Ok(())
    });
    let asr_stop = CancellationToken::new();
    let finish = CancellationToken::new();
    let listening = super::super::recovery::run(
        &request,
        &channel,
        &token,
        &finish,
        &asr_stop,
        &translation,
        &key,
    );
    let output = async {
        tokio::time::timeout(Duration::from_secs(25), ready_rx)
            .await
            .unwrap()
            .unwrap();
        let profile=serde_json::from_value(json!({"id":"provider-minimax-cn","stage":"tts","adapter":"minimax_tts_ws","baseUrl":"wss://api.minimax.cn/ws/v1/t2a_v2","modelId":"speech-2.8-turbo","voice":"male-qn-qingse"})).unwrap();
        let routing =
            serde_json::from_value(json!({"previewDeviceId":device_id,"sendDeviceId":""})).unwrap();
        let result = crate::speech::execute(
            profile,
            "这是边听边说测试，停止输出后，字幕监听应该继续工作。".into(),
            routing,
            crate::speech::Route::Preview,
            "duplex-output".into(),
            progress,
            &speech_state,
            &gate,
        )
        .await;
        assert!(result.is_err_and(|error| error == "语音已停止。"));
        assert!(
            !token.is_cancelled(),
            "stopping output must leave listening active"
        );
    };
    let drive = async {
        tokio::time::timeout(Duration::from_secs(40), playing_rx)
            .await
            .unwrap()
            .unwrap();
        player.command("speech");
        tokio::time::sleep(Duration::from_millis(300)).await;
        speech_state.stop_all();
        tokio::select! { _=token.cancelled()=>{}, _=tokio::time::sleep(Duration::from_secs(35))=>{token.cancel();} }
    };
    let (result, (), ()) = tokio::join!(listening, output, drive);
    result.unwrap();
    assert!(phases
        .lock()
        .unwrap()
        .iter()
        .any(|phase| phase == "playing"));
    assert_eq!(phases.lock().unwrap().last().unwrap(), "stopped");
    let events = events.lock().unwrap();
    let final_text = events
        .iter()
        .find(|event| event["type"] == "transcript" && event["final"] == true)
        .expect("final transcript");
    assert!(
        final_text["text"]
            .as_str()
            .unwrap()
            .to_lowercase()
            .contains("meeting"),
        "recognition must retain the generated fixture content"
    );
    let translated = events
        .iter()
        .find(|event| event["type"] == "translation")
        .unwrap();
    assert!(translated["text"].as_str().unwrap().contains("明天"));
    assert!(!events.iter().any(|event| event["type"] == "recovering"));
    println!(
        "LIVE_DUPLEX: {name}; simultaneous ASR/output, output stop, then final translation passed"
    );
}
