//! Bounded, buffered TTS prototype. No audio or credentials are written to disk.
use cpal::traits::{DeviceTrait, HostTrait};
use futures_util::{SinkExt, StreamExt};
use rodio::{buffer::SamplesBuffer, Decoder, OutputStreamBuilder, Sink, Source};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    io::Cursor,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio_tungstenite::tungstenite::{
    client::IntoClientRequest, protocol::WebSocketConfig, Message,
};
use tokio_util::sync::CancellationToken;

const MAX_AUDIO: usize = 8 * 1024 * 1024;
const STOPPED: &str = "语音已停止。";

pub struct AudioGate(pub Arc<tokio::sync::Semaphore>);

impl AudioGate {
    pub fn new() -> Self {
        Self(Arc::new(tokio::sync::Semaphore::new(1)))
    }
}

#[derive(Default)]
struct Registry {
    active: Option<(String, CancellationToken)>,
    cancelled: VecDeque<String>,
}
#[derive(Default)]
pub struct SpeechState(Arc<Mutex<Registry>>);

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
impl SpeechState {
    fn begin(&self, id: &str) -> Result<Job, String> {
        if id.is_empty() || id.len() > 128 {
            return Err("请求标识无效。".into());
        }
        let mut registry = self.0.lock().map_err(|_| "任务状态不可用。")?;
        if let Some(index) = registry.cancelled.iter().position(|old| old == id) {
            registry.cancelled.remove(index);
            return Err(STOPPED.into());
        }
        if registry.active.is_some() {
            return Err("已有语音任务，请先停止或等待完成。".into());
        }
        let token = CancellationToken::new();
        registry.active = Some((id.into(), token.clone()));
        Ok(Job {
            id: id.into(),
            token,
            registry: self.0.clone(),
        })
    }
    fn cancel(&self, id: String) -> Result<(), String> {
        if id.is_empty() || id.len() > 128 {
            return Err("请求标识无效。".into());
        }
        let mut registry = self.0.lock().map_err(|_| "任务状态不可用。")?;
        if let Some((active, token)) = &registry.active {
            if active == &id {
                token.cancel();
                return Ok(());
            }
        }
        if !registry.cancelled.contains(&id) {
            registry.cancelled.push_back(id);
            if registry.cancelled.len() > 64 {
                registry.cancelled.pop_front();
            }
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechProfile {
    id: String,
    stage: String,
    adapter: String,
    base_url: String,
    model_id: String,
    voice: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Routing {
    preview_device_id: String,
    send_device_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Route {
    Preview,
    Send,
}
impl Routing {
    fn destination(&self, route: &Route) -> Result<String, String> {
        let id = match route {
            Route::Preview => &self.preview_device_id,
            Route::Send => &self.send_device_id,
        };
        if id.is_empty() {
            return Err("请在常规设置中选择对应的音频输出设备。".into());
        }
        if matches!(route, Route::Send) && self.preview_device_id == self.send_device_id {
            return Err("试听与发送必须使用不同设备，请检查音频设置。".into());
        }
        Ok(id.clone())
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechProgress {
    request_id: String,
    phase: &'static str,
}
fn progress(channel: &tauri::ipc::Channel<SpeechProgress>, id: &str, phase: &'static str) {
    let _ = channel.send(SpeechProgress {
        request_id: id.into(),
        phase,
    });
}

pub(crate) fn endpoint(profile: &SpeechProfile) -> Result<url::Url, String> {
    if profile.stage != "tts"
        || !matches!(
            profile.adapter.as_str(),
            "minimax_tts_ws" | "openai_audio_speech"
        )
    {
        return Err("不支持的语音合成协议。".into());
    }
    if profile.model_id.trim().is_empty()
        || profile.model_id.len() > 200
        || profile.voice.trim().is_empty()
        || profile.voice.len() > 200
    {
        return Err("请配置模型 ID 和音色 ID（最多 200 字节）。".into());
    }
    let ws = profile.adapter == "minimax_tts_ws";
    let mut url = url::Url::parse(profile.base_url.trim()).map_err(|_| "API 地址无效。")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.scheme() != (if ws { "wss" } else { "https" })
        && !(local && url.scheme() == (if ws { "ws" } else { "http" }))
    {
        return Err("远程服务必须使用 HTTPS / WSS。".into());
    }
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("API 地址不能包含凭据、查询参数或片段。".into());
    }
    if !ws {
        let path = url.path().trim_end_matches('/');
        if path.ends_with("/audio/speech") {
            return Err("请填写 API 根地址，不包含 /audio/speech。".into());
        }
        url.set_path(&format!("{path}/audio/speech"));
    }
    Ok(url)
}
fn append_audio(audio: &mut Vec<u8>, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_AUDIO.saturating_sub(audio.len()) {
        return Err("语音响应超过 8 MiB 限制，请缩短文字。".into());
    }
    audio.extend_from_slice(bytes);
    Ok(())
}
fn provider_status(status: u16) -> String {
    let message = match status {
        400 => "语音请求参数无效，请检查接口协议、模型和音色。",
        401 | 403 => "语音服务认证失败，请检查密钥和权限。",
        429 => "语音服务限流或额度不足。",
        404 => "语音接口或模型不存在，请检查地址和模型。",
        405 => "语音接口与请求协议不匹配，请检查 API 地址。",
        500..=599 => "语音服务暂时不可用，请稍后重试。",
        _ => "语音服务请求失败，请检查服务配置或稍后重试。",
    };
    format!("{message}（HTTP {status}）")
}

fn websocket_handshake_failure(url: &url::Url, status: u16, body: Option<&[u8]>) -> String {
    let value = body
        .filter(|bytes| bytes.len() <= 16_384)
        .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok());
    let code = value
        .as_ref()
        .and_then(|value| value.pointer("/base_resp/status_code"))
        .and_then(Value::as_i64);
    let message = if code.is_some_and(|code| code != 0) {
        format!(
            "{}（HTTP {status}）",
            minimax_failure(value.as_ref().unwrap())
        )
    } else if status == 200 {
        "服务返回 HTTP 200，但未建立 WebSocket 连接。请检查接口地址与密钥所属区域。".into()
    } else {
        provider_status(status)
    };
    match url.host_str() {
        Some("api.minimax.io") => format!("{message} 当前连接 MiniMax 国际站；国内站地址为 wss://api.minimax.cn/ws/v1/t2a_v2，请使用与密钥匹配的地址。"),
        Some("api.minimax.cn") => format!("{message} 当前连接 MiniMax 国内站，请确认密钥来自国内平台。"),
        _ => message,
    }
}
fn minimax_failure(value: &Value) -> String {
    let code = value
        .pointer("/base_resp/status_code")
        .and_then(Value::as_i64);
    let message = match code {
        Some(1004 | 2049) => "MiniMax 认证失败，请检查密钥及所属区域。",
        Some(1008 | 2053) => "MiniMax 余额或积分不足，请检查账户。",
        Some(1002 | 1045 | 2062) => "MiniMax 请求受限，请稍后重试并检查额度。",
        Some(2013) => "MiniMax 参数无效，请检查模型和音色。",
        Some(2022 | 2061 | 2068 | 2069) => "MiniMax 模型不存在、已下线或当前账户无权使用。",
        Some(2042 | 2043 | 2054 | 20132) => "MiniMax 音色不存在、无权访问或与模型不兼容。",
        _ => "MiniMax 语音任务失败，请检查服务配置或稍后重试。",
    };
    // Only a numeric status and our own text are exposed; never echo status_msg.
    match code {
        Some(code) => format!("{message}（错误码 {code}）"),
        None => message.into(),
    }
}
async fn synthesize(
    profile: &SpeechProfile,
    url: url::Url,
    text: &str,
    key: &str,
) -> Result<Vec<u8>, String> {
    if profile.adapter == "openai_audio_speech" {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|_| "无法创建语音连接。")?;
        let mut response = client.post(url).bearer_auth(key).json(&json!({ "model": profile.model_id, "voice": profile.voice, "input": text, "response_format": "mp3" })).send().await.map_err(|_| "语音服务连接失败或超时。")?;
        if !response.status().is_success() {
            return Err(provider_status(response.status().as_u16()));
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_AUDIO as u64)
        {
            return Err("语音响应超过 8 MiB 限制。".into());
        }
        let mut audio = Vec::new();
        while let Some(bytes) = response.chunk().await.map_err(|_| "语音响应中断。")? {
            append_audio(&mut audio, &bytes)?;
        }
        if audio.is_empty() {
            return Err("服务返回了空音频。".into());
        }
        return Ok(audio);
    }
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|_| "语音地址无效。")?;
    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {key}")
            .parse()
            .map_err(|_| "密钥格式无效。")?,
    );
    let config = WebSocketConfig::default()
        .max_message_size(Some(512 * 1024))
        .max_frame_size(Some(512 * 1024));
    let (mut socket, _) = tokio_tungstenite::connect_async_with_config(request, Some(config), true)
        .await
        .map_err(|error| match error {
            tokio_tungstenite::tungstenite::Error::Http(response) => websocket_handshake_failure(
                &url,
                response.status().as_u16(),
                response.body().as_deref(),
            ),
            _ => "语音 WebSocket 连接失败。".into(),
        })?;
    async fn receive(
        socket: &mut tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    ) -> Result<Value, String> {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    let value: Value =
                        serde_json::from_str(&text).map_err(|_| "语音服务返回了无效消息。")?;
                    if value
                        .pointer("/base_resp/status_code")
                        .and_then(Value::as_i64)
                        .is_some_and(|code| code != 0)
                        || value["event"] == "task_failed"
                    {
                        return Err(minimax_failure(&value));
                    }
                    return Ok(value);
                }
                Some(Ok(Message::Ping(bytes))) => socket
                    .send(Message::Pong(bytes))
                    .await
                    .map_err(|_| "语音连接中断。")?,
                Some(Ok(Message::Pong(_))) => {}
                _ => return Err("语音连接提前关闭或响应格式不受支持。".into()),
            }
        }
    }
    if receive(&mut socket).await?["event"] != "connected_success" {
        return Err("语音连接握手顺序异常。".into());
    }
    socket.send(Message::Text(json!({ "event":"task_start", "model":profile.model_id, "voice_setting":{"voice_id":profile.voice}, "audio_setting":{"sample_rate":32000,"bitrate":128000,"format":"mp3","channel":1} }).to_string().into())).await.map_err(|_| "无法开始语音任务。")?;
    if receive(&mut socket).await?["event"] != "task_started" {
        return Err("语音任务未就绪。".into());
    }
    socket
        .send(Message::Text(
            json!({"event":"task_continue","text":text})
                .to_string()
                .into(),
        ))
        .await
        .map_err(|_| "无法提交语音文字。")?;
    let mut audio = Vec::new();
    loop {
        let value = receive(&mut socket).await?;
        if let Some(encoded) = value.pointer("/data/audio").and_then(Value::as_str) {
            let bytes = hex::decode(encoded).map_err(|_| "语音服务返回了无效音频编码。")?;
            append_audio(&mut audio, &bytes)?;
        }
        if value["is_final"] == true || value["event"] == "task_finished" {
            break;
        }
    }
    socket
        .send(Message::Text(
            json!({"event":"task_finish"}).to_string().into(),
        ))
        .await
        .map_err(|_| "无法结束语音任务。")?;
    // Best-effort close is bounded by the enclosing timeout and cancellation.
    let _ = socket.close(None).await;
    if audio.is_empty() {
        return Err("服务返回了空音频。".into());
    }
    Ok(audio)
}

pub(crate) async fn synthesize_cancellable(
    profile: &SpeechProfile,
    url: url::Url,
    text: &str,
    key: &str,
    token: &CancellationToken,
) -> Result<Vec<u8>, String> {
    tokio::select! {
        biased;
        _ = token.cancelled() => Err(STOPPED.into()),
        result = tokio::time::timeout(Duration::from_secs(60), synthesize(profile, url, text, key)) => result.map_err(|_| "语音合成超时，请重试。".to_string())?,
    }
}

pub(crate) fn decode(audio: Vec<u8>, token: &CancellationToken) -> Result<SamplesBuffer, String> {
    let byte_len = audio.len() as u64;
    // Streaming encoders may leave Xing's frame count at zero while LAME padding is nonzero.
    // Gapless trimming in Symphonia 0.5 underflows on that header. Decode actual frames instead.
    let mut decoder = Decoder::builder()
        .with_data(Cursor::new(audio))
        .with_byte_len(byte_len)
        .with_gapless(false)
        .build()
        .map_err(|_| "无法解码语音，服务必须返回 MP3 或 WAV。")?;
    let channels = decoder.channels();
    let rate = decoder.sample_rate();
    if !(1..=2).contains(&channels) || !(8000..=96000).contains(&rate) {
        return Err("语音采样格式不受支持。".into());
    }
    let limit = (rate as usize * channels as usize * 120).min(12_000_000);
    let mut samples = Vec::new();
    for sample in &mut decoder {
        if samples.len() % 4096 == 0 && token.is_cancelled() {
            return Err(STOPPED.into());
        }
        if samples.len() >= limit {
            return Err("语音超过时长或解码容量限制。".into());
        }
        samples.push(if sample.is_finite() {
            sample.clamp(-1.0, 1.0)
        } else {
            0.0
        });
    }
    if samples.is_empty() {
        return Err("语音解码结果为空。".into());
    }
    Ok(SamplesBuffer::new(channels, rate, samples))
}

fn playback(
    device_id: String,
    token: CancellationToken,
    ready: tokio::sync::oneshot::Sender<Result<(), String>>,
    audio: std::sync::mpsc::Receiver<Vec<u8>>,
    channel: tauri::ipc::Channel<SpeechProgress>,
    request_id: String,
) -> Result<(), String> {
    // The output stream stays on this blocking thread, including on macOS where it is !Send.
    let failed = Arc::new(AtomicBool::new(false));
    let setup = (|| {
        let mut devices = cpal::default_host()
            .output_devices()
            .map_err(|_| "无法枚举音频设备。")?
            .filter(|device| device.name().is_ok_and(|name| name == device_id));
        let device = devices.next().ok_or("输出设备已断开，请重新选择。")?;
        if devices.next().is_some() {
            return Err("存在同名设备，请断开多余设备后重试。".into());
        }
        let error_flag = failed.clone();
        let stream = OutputStreamBuilder::from_device(device)
            .map_err(|_| "无法读取设备格式。")?
            .with_error_callback(move |_| {
                error_flag.store(true, Ordering::SeqCst);
            })
            .open_stream()
            .map_err(|_| "无法打开所选输出设备。")?;
        Ok::<_, String>(stream)
    })();
    let stream = match setup {
        Ok(stream) => {
            let _ = ready.send(Ok(()));
            stream
        }
        Err(error) => {
            let _ = ready.send(Err(error.clone()));
            return Err(error);
        }
    };
    let bytes = loop {
        if token.is_cancelled() {
            return Err(STOPPED.into());
        }
        if failed.load(Ordering::SeqCst) {
            token.cancel();
            return Err("输出设备发生错误，请重新选择设备。".into());
        }
        match audio.recv_timeout(Duration::from_millis(20)) {
            Ok(bytes) => break bytes,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => return Err(STOPPED.into()),
        }
    };
    let source = decode(bytes, &token)?;
    if token.is_cancelled() {
        return Err(STOPPED.into());
    }
    let sink = Sink::connect_new(stream.mixer());
    sink.append(source);
    progress(&channel, &request_id, "playing");
    let started = Instant::now();
    loop {
        if token.is_cancelled() {
            sink.stop();
            return Err(STOPPED.into());
        }
        if failed.load(Ordering::SeqCst) {
            sink.stop();
            token.cancel();
            return Err("播放设备已断开或发生错误。".into());
        }
        if sink.empty() {
            return Ok(());
        }
        if started.elapsed() > Duration::from_secs(125) {
            sink.stop();
            return Err("语音播放超时。".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[tauri::command]
pub fn stop_speech(request_id: String, state: tauri::State<'_, SpeechState>) -> Result<(), String> {
    state.cancel(request_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn speak(
    profile: SpeechProfile,
    text: String,
    routing: Routing,
    route: Route,
    request_id: String,
    on_progress: tauri::ipc::Channel<SpeechProgress>,
    state: tauri::State<'_, SpeechState>,
    gate: tauri::State<'_, AudioGate>,
) -> Result<(), String> {
    let url = endpoint(&profile)?;
    if text.trim().is_empty() || text.chars().count() > 500 {
        return Err("语音文字须为 1–500 字。".into());
    }
    let device = routing.destination(&route)?;
    let job = state.begin(&request_id)?;
    let permit = gate
        .0
        .clone()
        .try_acquire_owned()
        .map_err(|_| "音频输出正忙，请等待当前播放结束。")?;
    let key = crate::credentials::read(&profile.id)?;
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let (audio_tx, audio_rx) = std::sync::mpsc::sync_channel(1);
    let token = job.token.clone();
    let channel = on_progress.clone();
    let id = request_id.clone();
    let worker = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        playback(device, token, ready_tx, audio_rx, channel, id)
    });
    let result = async {
        ready_rx
            .await
            .map_err(|_| "音频任务初始化失败。".to_string())??;
        progress(&on_progress, &request_id, "synthesizing");
        let bytes = synthesize_cancellable(&profile, url, &text, &key, &job.token).await?;
        if job.token.is_cancelled() {
            return Err(STOPPED.into());
        }
        progress(&on_progress, &request_id, "decoding");
        audio_tx
            .try_send(bytes)
            .map_err(|_| "音频输出任务已结束。".to_string())?;
        Ok(())
    }
    .await;
    drop(audio_tx);
    let stopped = job.token.is_cancelled();
    if result.is_err() {
        job.token.cancel();
    }
    let played = worker.await.map_err(|_| "音频播放任务失败。".to_string())?;
    let result = match (result, played) {
        (Err(error), Err(playback_error)) if error == STOPPED && playback_error != STOPPED => {
            Err(playback_error)
        }
        (result, played) => result.and(played),
    };
    progress(
        &on_progress,
        &request_id,
        if result.is_ok() {
            "completed"
        } else if stopped {
            "stopped"
        } else {
            "failed"
        },
    );
    result
}

#[cfg(test)]
mod tests;
