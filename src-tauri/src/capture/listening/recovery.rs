use super::*;
use tokio_util::sync::CancellationToken;

fn select_source(
    original: &CaptureSource,
    candidates: Vec<CaptureSource>,
) -> Result<CaptureSource, String> {
    if original.app_scoped {
        return candidates
            .into_iter()
            .find(|source| source.app_scoped && source.bundle_id == original.bundle_id)
            .ok_or_else(|| "正在等待目标应用恢复声音进程。".into());
    }
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

fn control_finish_result(result: Result<(), String>) -> Result<(), String> {
    result.map_err(|error| {
        if crate::recovery::transient(&error) {
            "尾句未能完成收尾，监听已停止；已完成字幕保留。".into()
        } else {
            error
        }
    })
}

async fn drain_until_deadline(
    worker: impl std::future::Future<Output = Result<(), String>>,
    control: &CancellationToken,
) -> Result<(), String> {
    tokio::pin!(worker);
    match tokio::time::timeout(Duration::from_secs(8), &mut worker).await {
        Ok(result) => result,
        Err(_) => {
            control.cancel();
            let _ = worker.await;
            Err("尾句收尾超时，监听已停止；已完成字幕保留。".into())
        }
    }
}

pub(super) async fn run(
    request: &ListeningRequest,
    channel: &tauri::ipc::Channel<ListeningEvent>,
    stop: &CancellationToken,
    finish: &CancellationToken,
    asr_stop: &CancellationToken,
    translation: &crate::providers::TranslationSession<'_>,
    key: &str,
) -> Result<(), String> {
    let control = stop.child_token();
    let _guard = control.clone().drop_guard();
    let started = Instant::now();
    let active = std::sync::atomic::AtomicBool::new(false);
    let worker = crate::recovery::supervise(
        &control,
        |generation| {
            let mut attempt = request.clone();
            let token = control.child_token();
            let active = &active;
            async move {
                if token.is_cancelled() || finish.is_cancelled() {
                    return Ok(());
                }
                if generation > 0 {
                    let app_scoped = attempt.source.app_scoped;
                    let candidates = tauri::async_runtime::spawn_blocking(move || {
                        if app_scoped {
                            super::super::native::sources()
                        } else {
                            super::super::native::process_sources()
                        }
                    })
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
                active.store(true, Ordering::Relaxed);
                let result = if attempt.asr_profile.is_realtime() {
                    realtime::run(
                        &attempt,
                        channel,
                        &token,
                        finish,
                        asr_stop,
                        translation,
                        key,
                    )
                    .await
                } else {
                    http::run(&attempt, channel, &token, asr_stop, translation, key).await
                };
                active.store(false, Ordering::Relaxed);
                // A failed drain must never reconnect or capture new audio after explicit stop.
                if finish.is_cancelled() {
                    control_finish_result(result)
                } else {
                    result
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
        _ = finish.cancelled() => {
            if !active.load(Ordering::Relaxed) { control.cancel(); return worker.await; }
            drain_until_deadline(&mut worker, &control).await
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test(start_paused = true)]
    async fn drain_has_a_deadline_and_force_cancellation_closes_the_worker() {
        let control = CancellationToken::new();
        let started = tokio::time::Instant::now();
        let worker = async {
            control.cancelled().await;
            Ok(())
        };
        let error = drain_until_deadline(worker, &control).await.unwrap_err();
        assert!(error.contains("收尾超时"));
        assert_eq!(started.elapsed(), Duration::from_secs(8));
        assert!(control.is_cancelled());
    }

    #[tokio::test(start_paused = true)]
    async fn successful_drain_does_not_wait_for_the_deadline() {
        let control = CancellationToken::new();
        let started = tokio::time::Instant::now();
        drain_until_deadline(
            async {
                tokio::time::sleep(Duration::from_millis(200)).await;
                Ok(())
            },
            &control,
        )
        .await
        .unwrap();
        assert_eq!(started.elapsed(), Duration::from_millis(200));
        assert!(!control.is_cancelled());
        let error =
            control_finish_result(Err("实时 ASR 连接已断开，请重新开始监听。".into())).unwrap_err();
        assert!(!crate::recovery::transient(&error));
    }

    #[tokio::test]
    async fn finishing_during_recovery_delay_does_not_open_another_capture_attempt() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}", listener.local_addr().unwrap());
        drop(listener);
        let request:ListeningRequest=serde_json::from_value(serde_json::json!({"source":{"pid":999,"bundleId":"fixture"},"sessionId":"stop-in-backoff","asrProfile":{"id":"fixture","stage":"asr","adapter":"qwen_dashscope_asr","baseUrl":url,"modelId":"fixture"},"translationProfile":{"id":"fixture","stage":"translation","adapter":"openai_chat_completions","baseUrl":"http://127.0.0.1:1","modelId":"fixture"},"sourceLanguage":"英语","targetLanguage":"简体中文"})).unwrap();
        let registry = crate::providers::Requests::default();
        let translation = registry
            .reserve_listening(
                request.translation_profile.clone(),
                &request.session_id,
                "fixture-key".into(),
            )
            .unwrap();
        let finish = CancellationToken::new();
        let signal = finish.clone();
        let events = Arc::new(std::sync::Mutex::new(Vec::<serde_json::Value>::new()));
        let observed = events.clone();
        let channel = tauri::ipc::Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(body) = body {
                let event: serde_json::Value = serde_json::from_str(&body).unwrap();
                if event["type"] == "recovering" {
                    signal.cancel();
                }
                observed.lock().unwrap().push(event);
            }
            Ok(())
        });
        let stop = CancellationToken::new();
        let asr_stop = CancellationToken::new();
        tokio::time::timeout(
            Duration::from_secs(2),
            run(
                &request,
                &channel,
                &stop,
                &finish,
                &asr_stop,
                &translation,
                "fixture-key",
            ),
        )
        .await
        .unwrap()
        .unwrap();
        let events = events.lock().unwrap();
        assert_eq!(
            events
                .iter()
                .filter(|event| event["type"] == "recovering")
                .count(),
            1
        );
        assert!(!events.iter().any(|event| event["type"] == "sourceChanged"));
    }

    fn source(pid: i32, bundle: &str) -> CaptureSource {
        CaptureSource {
            pid,
            bundle_id: bundle.into(),
            name: String::new(),
            app_scoped: false,
        }
    }
    #[test]
    fn app_recovery_tracks_bundle_not_pid_and_does_not_cross_scope() {
        let mut original = source(1, "chrome");
        original.app_scoped = true;
        let mut replacement = source(2, "chrome");
        replacement.app_scoped = true;
        assert_eq!(
            select_source(&original, vec![source(1, "other"), replacement])
                .unwrap()
                .pid,
            2
        );
        assert!(select_source(&original, vec![source(1, "chrome")]).is_err());
        assert!(select_source(&original, vec![source(1, "other")]).is_err());
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
