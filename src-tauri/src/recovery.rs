//! Retry only our own sanitized transient errors. Configuration / permission / auth failures stop.
use std::{future::Future, time::Duration};
use tokio_util::sync::CancellationToken;

pub(crate) fn transient(error: &str) -> bool {
    matches!(
        error,
        "实时 ASR 连接超时。"
            | "实时 ASR 连接失败。"
            | "实时 ASR 启动超时。"
            | "实时 ASR 连接中断。"
            | "实时 ASR 发送超时。"
            | "无法启动实时 ASR。"
            | "实时 ASR 连接已断开，请重新开始监听。"
            | "实时 ASR 音频发送失败。"
            | "实时 ASR 保活失败。"
            | "实时 ASR 响应超时，请重新监听。"
            | "ASR 请求超时。"
            | "ASR 响应中断。"
            | "无法连接 ASR 服务，请检查地址与网络。"
            | "翻译超时，请重试或更换服务。"
            | "无法连接翻译服务，请检查地址与网络。"
            | "翻译响应中断。"
            | "服务暂时不可用，请稍后重试。"
            | "系统暂停后需要重新连接音频。"
            | "监听采集设备已断开或发生错误。"
            | "监听采集回调中断。"
            | "音频采集发生中断，请重新开始监听。"
            | "实时识别发送积压或已断开，请重新监听。"
            | "目标音频进程已退出或改变，请刷新后重新监听。"
            | "目标音频进程已退出，请让目标应用播放声音后刷新。"
            | "正在等待目标应用恢复声音进程。"
            | "目标应用暂未提供声音，请播放声音后重试。"
    ) || error.starts_with("ASR 服务暂时不可用。")
        || error.starts_with("音频系统暂时不可用：")
}

const DELAYS: [u64; 6] = [1, 2, 4, 8, 15, 15];

pub(crate) async fn supervise<F: Future<Output = Result<(), String>>>(
    stop: &CancellationToken,
    mut operation: impl FnMut(u32) -> F,
    mut report: impl FnMut(u32, Duration, &str) -> Result<(), String>,
) -> Result<(), String> {
    let mut generation = 0_u32;
    let mut failures = 0;
    loop {
        if stop.is_cancelled() {
            return Ok(());
        }
        let started = tokio::time::Instant::now();
        let result = operation(generation).await;
        if stop.is_cancelled() {
            return Ok(());
        }
        match result {
            Ok(()) => return Ok(()),
            Err(error) => {
                if !transient(&error) {
                    return Err(error);
                }
                // A healthy minute replenishes the budget; rapidly flapping connections stay bounded.
                if started.elapsed() >= Duration::from_secs(60) {
                    failures = 0;
                }
                let Some(seconds) = DELAYS.get(failures) else {
                    return Err(format!(
                        "自动恢复未成功，请检查网络或设备后重新监听。{error}"
                    ));
                };
                failures += 1;
                generation = generation.checked_add(1).ok_or("恢复次数超出限制。")?;
                let delay = Duration::from_secs(*seconds);
                report(generation, delay, &error)?;
                tokio::select! { biased;
                    _ = stop.cancelled() => return Ok(()),
                    _ = tokio::time::sleep(delay) => {},
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
