use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

const MAX_WAV: usize = 1_000_000;
const MAX_RESPONSE: usize = 256 * 1024;
const STOPPED: &str = "语音识别已停止。";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AsrProfile {
    pub id: String,
    stage: String,
    adapter: String,
    base_url: String,
    pub model_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub text: String,
    pub audio_seconds: f64,
}

pub(crate) fn endpoint(profile: &AsrProfile) -> Result<url::Url, String> {
    if profile.stage != "asr" || profile.adapter != "qwen_chat_asr" {
        return Err("此配置不支持 Qwen HTTP 分段语音识别。".into());
    }
    if profile.model_id.trim().is_empty() || profile.model_id.len() > 200 {
        return Err("请输入有效的 ASR 模型 ID。".into());
    }
    let mut url = url::Url::parse(profile.base_url.trim()).map_err(|_| "ASR API 地址无效。")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.scheme() != "https" && !(local && url.scheme() == "http") {
        return Err("远程 ASR 必须使用 HTTPS。".into());
    }
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("ASR 地址不能包含凭据、查询参数或片段。".into());
    }
    let path = url.path().trim_end_matches('/');
    if path.ends_with("/chat/completions") {
        return Err("请填写 ASR API 根地址，不包含 /chat/completions。".into());
    }
    url.set_path(&format!("{path}/chat/completions"));
    Ok(url)
}

pub(crate) fn validate_wav(audio: &[u8]) -> Result<f64, String> {
    let invalid = || "仅支持 0.1–30 秒、16 kHz 单声道 PCM16 WAV，请先转换音频格式。".to_string();
    if audio.len() < 44
        || audio.len() > MAX_WAV
        || &audio[..4] != b"RIFF"
        || &audio[8..12] != b"WAVE"
    {
        return Err(invalid());
    }
    let length = u32::from_le_bytes(audio[4..8].try_into().unwrap()) as usize;
    if length.checked_add(8) != Some(audio.len()) {
        return Err(invalid());
    }
    let mut offset = 12;
    let mut format = false;
    let mut data_size = None;
    while offset + 8 <= audio.len() {
        let id = &audio[offset..offset + 4];
        let size = u32::from_le_bytes(audio[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let start = offset + 8;
        let end = start
            .checked_add(size)
            .filter(|end| *end <= audio.len())
            .ok_or_else(invalid)?;
        if id == b"fmt " {
            if format || size < 16 {
                return Err(invalid());
            }
            let payload = &audio[start..end];
            if u16::from_le_bytes(payload[..2].try_into().unwrap()) != 1
                || u16::from_le_bytes(payload[2..4].try_into().unwrap()) != 1
                || u32::from_le_bytes(payload[4..8].try_into().unwrap()) != 16_000
                || u32::from_le_bytes(payload[8..12].try_into().unwrap()) != 32_000
                || u16::from_le_bytes(payload[12..14].try_into().unwrap()) != 2
                || u16::from_le_bytes(payload[14..16].try_into().unwrap()) != 16
            {
                return Err(invalid());
            }
            format = true;
        } else if id == b"data" {
            if !format || data_size.is_some() || !size.is_multiple_of(2) {
                return Err(invalid());
            }
            data_size = Some(size);
        }
        offset = end + size % 2;
    }
    let seconds = data_size.ok_or_else(invalid)? as f64 / 32_000.0;
    if !format || offset != audio.len() || !(0.1..=30.0).contains(&seconds) {
        return Err(invalid());
    }
    Ok(seconds)
}

fn status_error(status: u16) -> String {
    let message = match status {
        401 | 403 => "ASR 认证失败或无模型权限，请检查密钥与账号。",
        402 => "ASR 服务余额不足。",
        404 => "ASR 模型或接口不存在，请检查模型名与 API 地址。",
        429 => "ASR 限流或额度不足，请检查账户。",
        500..=599 => "ASR 服务暂时不可用。",
        _ => "ASR 拒绝音频请求，请检查模型与音频协议。",
    };
    format!("{message}（HTTP {status}）")
}

fn parse_response(bytes: &[u8], seconds: f64) -> Result<Transcript, String> {
    let body: Value = serde_json::from_slice(bytes).map_err(|_| "ASR 返回了无法解析的响应。")?;
    if body.get("error").is_some_and(|error| !error.is_null()) {
        return Err("ASR 返回了服务错误，请检查模型权限与协议。".into());
    }
    let reason = body
        .pointer("/choices/0/finish_reason")
        .and_then(Value::as_str);
    if !matches!(reason, Some("stop")) {
        return Err("ASR 未正常完成转写，请检查模型与音频长度。".into());
    }
    let text = body
        .pointer("/choices/0/message/content")
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

pub(crate) async fn recognize(
    profile: &AsrProfile,
    audio: &[u8],
    key: &str,
    token: &CancellationToken,
) -> Result<Transcript, String> {
    let url = endpoint(profile)?;
    let seconds = validate_wav(audio)?;
    tokio::select! {
        biased;
        _ = token.cancelled() => Err(STOPPED.into()),
        result = async {
            let client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|_| "无法初始化 ASR 连接。")?;
            let body = json!({
                "model": profile.model_id,
                "stream": false,
                "messages": [{"role":"user","content":[{
                    "type":"input_audio", "input_audio":{"data":format!("data:audio/wav;base64,{}", STANDARD.encode(audio))}
                }]}]
            });
            let mut response = client.post(url).bearer_auth(key).json(&body).send().await
                .map_err(|error| if error.is_timeout() { "ASR 请求超时。" } else { "无法连接 ASR 服务，请检查地址与网络。" })?;
            if !response.status().is_success() {
                return Err(status_error(response.status().as_u16()));
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| "ASR 响应中断。")? {
                if bytes.len() + chunk.len() > MAX_RESPONSE {
                    return Err("ASR 响应超过大小限制。".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            parse_response(&bytes, seconds)
        } => result,
    }
}

#[derive(Default)]
struct Registry {
    active: Option<(String, CancellationToken)>,
    cancelled: VecDeque<String>,
}
#[derive(Default)]
pub struct AsrState(Arc<Mutex<Registry>>);
struct Job {
    id: String,
    token: CancellationToken,
    registry: Arc<Mutex<Registry>>,
}
impl Drop for Job {
    fn drop(&mut self) {
        self.token.cancel();
        if let Ok(mut registry) = self.registry.lock() {
            if registry
                .active
                .as_ref()
                .is_some_and(|(id, _)| id == &self.id)
            {
                registry.active = None;
            }
        }
    }
}
impl AsrState {
    pub fn stop_all(&self) {
        if let Ok(registry) = self.0.lock() {
            if let Some((_, token)) = &registry.active {
                token.cancel();
            }
        }
    }

    fn begin(&self, id: &str) -> Result<Job, String> {
        if id.is_empty() || id.len() > 128 {
            return Err("ASR 请求标识无效。".into());
        }
        let mut registry = self.0.lock().map_err(|_| "ASR 任务状态不可用。")?;
        if let Some(index) = registry.cancelled.iter().position(|old| old == id) {
            registry.cancelled.remove(index);
            return Err(STOPPED.into());
        }
        if registry.active.is_some() {
            return Err("已有 ASR 任务，请先停止。".into());
        }
        let token = CancellationToken::new();
        registry.active = Some((id.into(), token.clone()));
        Ok(Job {
            id: id.into(),
            token,
            registry: self.0.clone(),
        })
    }
    fn cancel(&self, id: &str) -> Result<(), String> {
        if id.is_empty() || id.len() > 128 {
            return Err("ASR 请求标识无效。".into());
        }
        let mut registry = self.0.lock().map_err(|_| "ASR 任务状态不可用。")?;
        if let Some((active, token)) = &registry.active {
            if active == id {
                token.cancel();
                return Ok(());
            }
        }
        if !registry.cancelled.iter().any(|old| old == id) {
            registry.cancelled.push_back(id.into());
            if registry.cancelled.len() > 64 {
                registry.cancelled.pop_front();
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub fn stop_asr(request_id: String, state: tauri::State<'_, AsrState>) -> Result<(), String> {
    state.cancel(&request_id)
}

#[tauri::command]
pub async fn transcribe_wav(
    profile: AsrProfile,
    audio: Vec<u8>,
    request_id: String,
    state: tauri::State<'_, AsrState>,
) -> Result<Transcript, String> {
    endpoint(&profile)?;
    validate_wav(&audio)?;
    let job = state.begin(&request_id)?;
    let key = crate::credentials::read(&profile.id)?;
    recognize(&profile, &audio, &key, &job.token).await
}

#[cfg(test)]
mod tests;
