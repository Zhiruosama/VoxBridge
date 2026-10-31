use super::{AsrProfile, Transcript};
use reqwest::multipart::{Form, Part};
use serde_json::Value;

pub(super) fn form(profile: &AsrProfile, audio: &[u8]) -> Result<Form, String> {
    let file = Part::bytes(audio.to_vec())
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|_| "无法初始化 ASR 连接。")?;
    // JSON text is supported by all four models and fits the shared caption contract.
    // Speaker segments are not displayed or retained by VoxBridge.
    let mut form = Form::new()
        .part("file", file)
        .text("model", profile.model_id.clone())
        .text("response_format", "json");
    if profile.model_id == "gpt-4o-transcribe-diarize" {
        form = form.text("chunking_strategy", "auto");
    }
    Ok(form)
}

pub(super) fn parse_response(bytes: &[u8], seconds: f64) -> Result<Transcript, String> {
    let body: Value = serde_json::from_slice(bytes).map_err(|_| "ASR 返回了无法解析的响应。")?;
    if body.get("error").is_some_and(|error| !error.is_null()) {
        return Err("ASR 返回了服务错误，请检查模型权限与协议。".into());
    }
    let text = body
        .get("text")
        .and_then(Value::as_str)
        .ok_or("ASR 响应缺少文本。")?
        .trim();
    if text.chars().count() > 6000 {
        return Err("ASR 文本超过长度限制。".into());
    }
    Ok(Transcript {
        text: text.into(),
        audio_seconds: seconds,
    })
}
