use super::*;
use futures_util::{SinkExt, StreamExt};
use std::collections::BTreeMap;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::{
    client::IntoClientRequest, protocol::WebSocketConfig, Message,
};

pub(crate) fn endpoint(profile: &AsrProfile) -> Result<url::Url, String> {
    if profile.stage != "asr"
        || profile.adapter != "qwen_dashscope_asr"
        || profile.model_id.trim().is_empty()
        || profile.model_id.len() > 200
    {
        return Err("请配置千问实时 ASR 协议及模型。".into());
    }
    let url = url::Url::parse(profile.base_url.trim()).map_err(|_| "实时 ASR 地址无效。")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if (url.scheme() != "wss" && !(local && url.scheme() == "ws"))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("实时 ASR 需要无凭据 / 查询参数的 WSS 地址，本机测试可用 WS。".into());
    }
    Ok(url)
}

#[derive(Clone, Debug)]
pub(crate) struct Sentence {
    pub id: u64,
    pub revision: u32,
    pub text: String,
    pub final_text: bool,
    pub start_ms: u64,
}

#[derive(Default)]
struct Results {
    revisions: BTreeMap<u64, (u32, bool, String)>,
    last_final: u64,
}
impl Results {
    fn accept(&mut self, value: &Value) -> Result<Option<Sentence>, String> {
        let sentence = value
            .pointer("/payload/output/sentence")
            .ok_or("实时 ASR 响应缺少句子。")?;
        if sentence["heartbeat"] == true {
            return Ok(None);
        }
        let id = sentence["sentence_id"]
            .as_u64()
            .ok_or("实时 ASR 句子标识无效。")?;
        if id == 0 || id <= self.last_final {
            return Ok(None);
        }
        let text = sentence["text"]
            .as_str()
            .ok_or("实时 ASR 响应缺少文本。")?
            .trim();
        if text.chars().count() > 6000 {
            return Err("实时 ASR 文本超过长度限制。".into());
        }
        if text.is_empty() {
            return Ok(None);
        }
        let final_text = sentence["sentence_end"]
            .as_bool()
            .ok_or("实时 ASR 定稿标识无效。")?;
        let start_ms = sentence["begin_time"]
            .as_u64()
            .ok_or("实时 ASR 时间戳无效。")?;
        let current = self
            .revisions
            .entry(id)
            .or_insert((0, false, String::new()));
        if current.1 || (current.2 == text && !final_text) {
            return Ok(None);
        }
        current.0 = current.0.checked_add(1).ok_or("实时 ASR 修订过多。")?;
        current.1 = final_text;
        current.2 = text.into();
        let result = Sentence {
            id,
            revision: current.0,
            text: text.into(),
            final_text,
            start_ms,
        };
        if final_text {
            self.last_final = id;
            self.revisions.retain(|key, _| *key > id);
        }
        if self.revisions.len() > 16 {
            return Err("实时 ASR 未定稿片段过多。".into());
        }
        Ok(Some(result))
    }
}

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
async fn write(socket: &mut Socket, message: Message) -> Result<(), String> {
    tokio::time::timeout(Duration::from_secs(5), socket.send(message))
        .await
        .map_err(|_| "实时 ASR 发送超时。")?
        .map_err(|_| "实时 ASR 连接中断。".into())
}

async fn receive(socket: &mut Socket) -> Result<Value, String> {
    loop {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => {
                return serde_json::from_str(&text).map_err(|_| "实时 ASR 响应格式无效。".into())
            }
            Some(Ok(Message::Ping(bytes))) => write(socket, Message::Pong(bytes)).await?,
            Some(Ok(Message::Pong(_))) => {}
            _ => return Err("实时 ASR 连接已断开，请重新开始监听。".into()),
        }
    }
}

pub(crate) async fn recognize_stream(
    profile: &AsrProfile,
    key: &str,
    token: &CancellationToken,
    mut audio: mpsc::Receiver<Vec<u8>>,
    ready: oneshot::Sender<()>,
    mut emit: impl FnMut(Sentence) -> Result<(), String>,
) -> Result<(), String> {
    tokio::select! {biased;
        _=token.cancelled()=>Ok(()),
        result=async {
            let mut request=endpoint(profile)?.as_str().into_client_request().map_err(|_|"实时 ASR 地址无效。")?;
            request.headers_mut().insert("Authorization",format!("Bearer {key}").parse().map_err(|_|"ASR 密钥格式无效。")?);
            let config=WebSocketConfig::default().max_message_size(Some(MAX_RESPONSE)).max_frame_size(Some(MAX_RESPONSE));
            let (mut socket,_)=tokio::time::timeout(Duration::from_secs(15),tokio_tungstenite::connect_async_with_config(request,Some(config),true)).await.map_err(|_|"实时 ASR 连接超时。")?
                .map_err(|error|match error {tokio_tungstenite::tungstenite::Error::Http(response)=>status_error(response.status().as_u16()),_=>"实时 ASR 连接失败。".into()})?;
            static SEQUENCE:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(0);
            let clock=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"系统时间不可用。")?.as_nanos();
            let task_id=format!("{:032x}",clock ^ (u128::from(std::process::id())<<64) ^ u128::from(SEQUENCE.fetch_add(1,std::sync::atomic::Ordering::Relaxed)));
            write(&mut socket, Message::Text(json!({"header":{"action":"run-task","task_id":task_id,"streaming":"duplex"},"payload":{"task_group":"audio","task":"asr","function":"recognition","model":profile.model_id,"parameters":{"format":"pcm","sample_rate":16000,"max_sentence_silence":400,"multi_threshold_mode_enabled":true},"input":{}}}).to_string().into())).await.map_err(|_|"无法启动实时 ASR。")?;
            let started=tokio::time::timeout(Duration::from_secs(15),receive(&mut socket)).await.map_err(|_|"实时 ASR 启动超时。")??;
            if started.pointer("/header/event").and_then(Value::as_str)!=Some("task-started") || started.pointer("/header/task_id").and_then(Value::as_str)!=Some(task_id.as_str()) {
                return Err("实时 ASR 任务未就绪，请检查模型权限与协议。".into());
            }
            ready.send(()).map_err(|_|"实时 ASR 采集任务已结束。")?;
            let mut results=Results::default();
            let mut finishing=false;
            let mut finish_deadline=tokio::time::Instant::now()+Duration::from_secs(45);
            let mut ping=tokio::time::interval(Duration::from_secs(15));
            let mut last_received=tokio::time::Instant::now();
            loop {
                tokio::select! {biased;
                    incoming=socket.next()=>{
                        last_received=tokio::time::Instant::now();
                        match incoming {
                            Some(Ok(Message::Text(text)))=>{
                                let value:Value=serde_json::from_str(&text).map_err(|_|"实时 ASR 响应格式无效。")?;
                                if value.pointer("/header/task_id").and_then(Value::as_str)!=Some(task_id.as_str()){return Err("实时 ASR 任务标识不匹配。".into());}
                                match value.pointer("/header/event").and_then(Value::as_str) {
                                    Some("result-generated")=>{if let Some(sentence)=results.accept(&value)? {emit(sentence)?;}},
                                    Some("task-finished") if finishing=>{let _=tokio::time::timeout(Duration::from_secs(1),socket.close(None)).await;return Ok(());},
                                    Some("task-failed")=>return Err("实时 ASR 任务失败，请检查服务额度、模型权限或音频格式。".into()),
                                    Some("task-started")=>{},
                                    _=>return Err("实时 ASR 返回未知任务事件。".into()),
                                }
                            },
                            Some(Ok(Message::Ping(bytes)))=>{write(&mut socket, Message::Pong(bytes)).await.map_err(|_|"实时 ASR 连接中断。")?;},
                            Some(Ok(Message::Pong(_)))=>{},
                            _=>return Err("实时 ASR 连接已断开，请重新开始监听。".into()),
                        }
                    },
                    chunk=audio.recv(),if !finishing=>match chunk {
                        Some(bytes)=>{
                            if bytes.is_empty() || bytes.len()>6400 || !bytes.len().is_multiple_of(2){return Err("实时 ASR 音频块无效。".into());}
                            write(&mut socket, Message::Binary(bytes.into())).await.map_err(|_|"实时 ASR 音频发送失败。")?;
                        },
                        None=>{finishing=true;finish_deadline=tokio::time::Instant::now()+Duration::from_secs(10);write(&mut socket, Message::Text(json!({"header":{"action":"finish-task","task_id":task_id,"streaming":"duplex"},"payload":{"input":{}}}).to_string().into())).await.map_err(|_|"无法结束实时 ASR。")?;},
                    },
                    _=ping.tick()=>{write(&mut socket, Message::Ping(Vec::new().into())).await.map_err(|_|"实时 ASR 保活失败。")?;},
                    _=tokio::time::sleep_until(if finishing {finish_deadline} else {last_received+Duration::from_secs(45)})=>return Err("实时 ASR 响应超时，请重新监听。".into()),
                }
            }
        }=>result,
    }
}

#[cfg(test)]
mod tests;
