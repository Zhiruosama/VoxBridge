use super::*;
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use std::io::{Read, Write};
use tokio::time::Instant;

const PCM_PACKET: usize = 3_200; // 100 ms of mono PCM16 at 16 kHz
const KEEPALIVE: Duration = Duration::from_secs(15);
const BAD_FRAME: &str = "豆包实时识别返回了无效的数据帧。";

fn encode(kind: u8, sequence: i32, payload: &[u8]) -> Result<Message, String> {
    let mut gzip = GzEncoder::new(Vec::new(), Compression::fast());
    gzip.write_all(payload)
        .map_err(|_| "无法压缩豆包识别请求。")?;
    let payload = gzip.finish().map_err(|_| "无法压缩豆包识别请求。")?;
    let flags = if sequence < 0 { 3 } else { 1 };
    let format = if kind == 1 { 0x11 } else { 0x01 };
    let mut frame = vec![0x11, (kind << 4) | flags, format, 0];
    frame.extend_from_slice(&sequence.to_be_bytes());
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(&payload);
    Ok(Message::Binary(frame.into()))
}

#[derive(Deserialize)]
struct Recognition {
    #[serde(default)]
    utterances: Vec<Utterance>,
}

#[derive(Deserialize)]
struct Utterance {
    text: String,
    start_time: u64,
    end_time: u64,
    definite: bool,
}

#[derive(Deserialize)]
struct Response {
    result: Option<Recognition>,
}

fn decode(frame: &[u8]) -> Result<(Response, bool), String> {
    let header: &[u8; 4] = frame
        .get(..4)
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or(BAD_FRAME)?;
    let header_size = usize::from(header[0] & 15) * 4;
    let kind = header[1] >> 4;
    let flags = header[1] & 15;
    if header[0] >> 4 != 1 || header_size < 4 || flags > 3 || !matches!(kind, 9 | 15) {
        return Err(BAD_FRAME.into());
    }
    let mut body = frame.get(header_size..).ok_or(BAD_FRAME)?;
    let take_word = |body: &mut &[u8]| -> Result<u32, String> {
        let (integer, rest) = body.split_first_chunk::<4>().ok_or(BAD_FRAME)?;
        *body = rest;
        Ok(u32::from_be_bytes(*integer))
    };
    let code = if kind == 15 {
        Some(take_word(&mut body)?)
    } else {
        None
    };
    if kind == 9 && flags & 1 != 0 {
        take_word(&mut body)?;
    }
    let length = take_word(&mut body)? as usize;
    if length != body.len() || length > MAX_RESPONSE {
        return Err(BAD_FRAME.into());
    }
    if let Some(code) = code {
        return Err(format!("豆包实时识别服务返回错误（{code}）。"));
    }
    if header[2] >> 4 != 1 {
        return Err(BAD_FRAME.into());
    }
    let response = match header[2] & 15 {
        0 => serde_json::from_slice(body),
        1 => {
            let mut decoded = Vec::new();
            GzDecoder::new(body)
                .take(MAX_RESPONSE as u64 + 1)
                .read_to_end(&mut decoded)
                .map_err(|_| BAD_FRAME)?;
            if decoded.len() > MAX_RESPONSE {
                return Err(BAD_FRAME.into());
            }
            serde_json::from_slice(&decoded)
        }
        _ => return Err(BAD_FRAME.into()),
    }
    .map_err(|_| BAD_FRAME)?;
    Ok((response, flags & 2 != 0))
}

#[derive(Default)]
struct Results {
    finalized_end: u64,
    id: u64,
    revision: u32,
    partial: String,
}

impl Results {
    fn accept(
        &mut self,
        response: Response,
        emit: &mut impl FnMut(Sentence) -> Result<(), String>,
    ) -> Result<(), String> {
        let Some(result) = response.result else {
            return Ok(());
        };
        // With incremental results the service repeats the active utterance and
        // occasionally sends its definitive version alongside the next preview.
        for utterance in result.utterances {
            let text = utterance.text.trim();
            if text.is_empty()
                || utterance.end_time <= self.finalized_end
                || utterance.end_time < utterance.start_time
                || (!utterance.definite && self.partial == text)
            {
                continue;
            }
            if text.chars().count() > 6_000 {
                return Err("实时 ASR 文本超过长度限制。".into());
            }
            self.revision += 1;
            emit(Sentence {
                id: self.id + 1,
                revision: self.revision,
                text: text.into(),
                final_text: utterance.definite,
                start_ms: utterance.start_time,
            })?;
            if utterance.definite {
                self.finalized_end = utterance.end_time;
                self.id += 1;
                self.revision = 0;
                self.partial.clear();
            } else {
                self.partial = text.into();
            }
        }
        Ok(())
    }
}

pub(super) async fn recognize(
    profile: &AsrProfile,
    language: &str,
    key: &str,
    token: &CancellationToken,
    mut audio: mpsc::Receiver<Vec<u8>>,
    ready: oneshot::Sender<()>,
    mut emit: impl FnMut(Sentence) -> Result<(), String>,
) -> Result<(), String> {
    tokio::select! { biased;
        _ = token.cancelled() => Ok(()),
        result = async {
            let mut request = endpoint(profile)?
                .as_str()
                .into_client_request()
                .map_err(|_| "实时 ASR 地址无效。")?;
            let request_id = uuid::Uuid::new_v4().to_string();
            for (name, value) in [
                ("x-api-key", key),
                ("x-api-resource-id", profile.model_id.trim()),
                ("x-api-request-id", &request_id),
            ] {
                request.headers_mut().insert(
                    name,
                    value.parse().map_err(|_| "豆包 ASR 请求头格式无效。")?,
                );
            }
            let mut socket = connect(request).await?;
            let mut initial = json!({
                "user": {"uid": "voxbridge"},
                "audio": {"format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1},
                "request": {
                    "model_name": "bigmodel", "enable_nonstream": true,
                    "show_utterances": true, "result_type": "single"
                }
            });
            if language == "繁体中文" {
                initial["request"]["output_zh_variant"] = json!("traditional");
            }
            write(&mut socket, encode(1, 1, initial.to_string().as_bytes())?).await?;
            let (ack, finished) = tokio::time::timeout(Duration::from_secs(15), async {
                loop {
                    if let Some(frame) = receive_frame(&mut socket).await? {
                        return Ok::<_, String>(frame);
                    }
                }
            }).await.map_err(|_| "实时 ASR 启动超时。")??;
            if finished {
                return Err("豆包实时 ASR 任务未就绪。".into());
            }
            let mut results = Results::default();
            results.accept(ack, &mut emit)?;
            ready.send(()).map_err(|_| "实时 ASR 采集任务已结束。")?;

            let mut packet = Vec::with_capacity(PCM_PACKET);
            let mut sequence = 2;
            let mut finish_deadline = None;
            let mut last_received = Instant::now();
            let mut ping = tokio::time::interval_at(last_received + KEEPALIVE, KEEPALIVE);
            loop {
                let deadline = finish_deadline.unwrap_or(last_received + Duration::from_secs(45));
                tokio::select! { biased;
                    result = receive_frame(&mut socket) => {
                        let frame = result?;
                        last_received = Instant::now();
                        let Some((response, finished)) = frame else { continue };
                        results.accept(response, &mut emit)?;
                        if finished {
                            return if finish_deadline.is_some() {
                                Ok(())
                            } else {
                                Err("豆包实时 ASR 提前结束，请重新监听。".into())
                            };
                        }
                    }
                    chunk = audio.recv(), if finish_deadline.is_none() => match chunk {
                        Some(chunk) => {
                            if chunk.is_empty() || chunk.len() > 6_400 || !chunk.len().is_multiple_of(2) {
                                return Err("实时 ASR 音频块无效。".into());
                            }
                            for part in chunk.chunks(PCM_PACKET) {
                                packet.extend_from_slice(part);
                                if packet.len() >= PCM_PACKET {
                                    write(&mut socket, encode(2, sequence, &packet[..PCM_PACKET])?).await?;
                                    packet.drain(..PCM_PACKET);
                                    sequence += 1;
                                }
                            }
                        }
                        None => {
                            if sequence == 2 && packet.is_empty() {
                                return Ok(());
                            }
                            write(&mut socket, encode(2, -sequence, &packet)?).await?;
                            finish_deadline = Some(Instant::now() + Duration::from_secs(10));
                        }
                    },
                    _ = ping.tick(), if finish_deadline.is_none() => {
                        write(&mut socket, Message::Ping(Vec::new().into())).await?;
                    }
                    _ = tokio::time::sleep_until(deadline) => return Err("实时 ASR 响应超时，请重新监听。".into()),
                }
            }
        } => result,
    }
}

async fn receive_frame(socket: &mut Socket) -> Result<Option<(Response, bool)>, String> {
    match socket.next().await {
        Some(Ok(Message::Binary(bytes))) => decode(&bytes).map(Some),
        Some(Ok(Message::Ping(bytes))) => {
            write(socket, Message::Pong(bytes)).await?;
            Ok(None)
        }
        Some(Ok(Message::Pong(_))) => Ok(None),
        _ => Err("实时 ASR 连接已断开，请重新开始监听。".into()),
    }
}

#[cfg(test)]
mod tests;
