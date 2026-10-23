use super::*;
use tokio_util::sync::CancellationToken;

fn select_source(
    original: &CaptureSource,
    candidates: Vec<CaptureSource>,
) -> Result<CaptureSource, String> {
    if let Some(source) = candidates
        .iter()
        .find(|s| s.pid == original.pid && s.bundle_id == original.bundle_id)
    {
        return Ok(source.clone());
    }
    // Never bind a different process on PID alone or guess among multiple browser processes.
    if original.bundle_id.is_empty() {
        return Err("正在等待目标应用恢复声音进程。".into());
    }
    let mut matching = candidates
        .into_iter()
        .filter(|s| s.bundle_id == original.bundle_id && s.pid as u32 != std::process::id());
    let source = matching.next().ok_or("正在等待目标应用恢复声音进程。")?;
    if matching.next().is_some() {
        return Err("目标应用有多个音频进程，请刷新后重新选择。".into());
    }
    Ok(source)
}

pub(super) async fn run(
    request: &ListeningRequest,
    channel: &tauri::ipc::Channel<ListeningEvent>,
    stop: &CancellationToken,
    asr_stop: &CancellationToken,
    translation: &crate::providers::TranslationSession<'_>,
    key: &str,
) -> Result<(), String> {
    let control = stop.child_token();
    let _guard = control.clone().drop_guard();
    let started = Instant::now();
    let worker = crate::recovery::supervise(
        &control,
        |generation| {
            let mut attempt = request.clone();
            let token = control.child_token();
            async move {
                if token.is_cancelled() {
                    return Ok(());
                }
                if generation > 0 {
                    let candidates =
                        tauri::async_runtime::spawn_blocking(super::super::native::sources)
                            .await
                            .map_err(|_| "读取音频进程失败。".to_string())??;
                    attempt.source = select_source(&attempt.source, candidates)?;
                    if token.is_cancelled() {
                        return Ok(());
                    }
                    send(
                        channel,
                        ListeningEvent::SourceChanged {
                            session_id: request.session_id.clone(),
                            generation,
                            source: attempt.source.clone(),
                        },
                    )?;
                }
                attempt.generation = generation;
                attempt.offset_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                if attempt.asr_profile.is_realtime() {
                    realtime::run(&attempt, channel, &token, asr_stop, translation, key).await
                } else {
                    http::run(&attempt, channel, &token, asr_stop, translation, key).await
                }
            }
        },
        |attempt, delay, reason| {
            send(
                channel,
                ListeningEvent::Recovering {
                    session_id: request.session_id.clone(),
                    attempt,
                    delay_ms: delay.as_millis() as u64,
                    reason: reason.into(),
                },
            )
        },
    );
    let cancelled = async {
        tokio::select! {
            _ = stop.cancelled() => {}, _ = asr_stop.cancelled() => {}, _ = translation.token.cancelled() => {},
        };
        control.cancel();
    };
    tokio::pin!(worker);
    tokio::select! { biased;
        _ = cancelled => worker.await,
        result = &mut worker => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source(pid: i32, bundle: &str) -> CaptureSource {
        CaptureSource {
            pid,
            bundle_id: bundle.into(),
        }
    }
    #[test]
    fn recovery_requires_exact_identity_or_unique_bundle() {
        assert_eq!(
            select_source(
                &source(1, "chrome"),
                vec![source(1, "other"), source(2, "chrome")]
            )
            .unwrap()
            .pid,
            2
        );
        assert_eq!(
            select_source(
                &source(1, "chrome"),
                vec![source(1, "chrome"), source(2, "chrome")]
            )
            .unwrap()
            .pid,
            1
        );
        assert!(select_source(
            &source(1, "chrome"),
            vec![source(2, "chrome"), source(3, "chrome")]
        )
        .unwrap_err()
        .contains("多个"));
        assert!(select_source(&source(1, ""), vec![source(2, "")]).is_err());
        assert!(select_source(&source(1, "chrome"), vec![source(1, "other")]).is_err());
    }
}

#[cfg(test)]
mod native_tests;
