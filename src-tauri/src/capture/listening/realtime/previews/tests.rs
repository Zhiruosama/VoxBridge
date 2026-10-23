use super::*;
use std::sync::Mutex;

fn sentence(id: u64, revision: u32, text: &str, final_text: bool) -> Sentence {
    Sentence {
        id,
        revision,
        text: text.into(),
        final_text,
        start_ms: 0,
    }
}

#[tokio::test(start_paused = true)]
async fn previews_coalesce_throttle_and_final_results_have_priority() {
    let token = CancellationToken::new();
    let (final_tx, final_rx) = mpsc::channel(4);
    let (preview_tx, preview_rx) = watch::channel(None);
    let requested = Mutex::new(Vec::new());
    let (observed_tx, mut observed_rx) = mpsc::unbounded_channel();
    let emitted = Mutex::new(Vec::new());
    let skipped = AtomicU64::new(0);
    let worker = translate_updates(
        &token,
        final_rx,
        preview_rx,
        &skipped,
        |s| {
            requested
                .lock()
                .unwrap()
                .push((s.id, s.revision, s.final_text));
            observed_tx.send((s.id, s.revision, s.final_text)).unwrap();
            async { Ok("译文".into()) }
        },
        |s, _| {
            emitted.lock().unwrap().push((s.id, s.revision));
            Ok(())
        },
    );
    let drive = async {
        tokio::task::yield_now().await;
        preview_tx.send_replace(Some(sentence(1, 1, "First partial", false)));
        tokio::time::sleep(Duration::from_millis(1500)).await;
        tokio::task::yield_now().await;
        assert_eq!(observed_rx.recv().await.unwrap(), (1, 1, false));
        assert_eq!(requested.lock().unwrap().len(), 1);
        for revision in 2..=50 {
            preview_tx.send_replace(Some(sentence(
                1,
                revision,
                &format!("Latest partial {revision}"),
                false,
            )));
        }
        tokio::time::sleep(Duration::from_millis(1000)).await;
        assert_eq!(requested.lock().unwrap().len(), 1);
        tokio::time::sleep(Duration::from_millis(500)).await;
        tokio::task::yield_now().await;
        assert_eq!(observed_rx.recv().await.unwrap(), (1, 50, false));
        preview_tx.send_replace(None);
        final_tx
            .send((sentence(1, 51, "Final sentence", true), Instant::now()))
            .await
            .unwrap();
        tokio::task::yield_now().await;
        assert_eq!(observed_rx.recv().await.unwrap(), (1, 51, true));
        tokio::time::sleep(Duration::from_secs(3)).await;
        assert_eq!(requested.lock().unwrap().len(), 3);
        token.cancel();
    };
    let (result, ()) = tokio::join!(worker, drive);
    result.unwrap();
    assert_eq!(emitted.lock().unwrap().len(), 3);
}

#[tokio::test(start_paused = true)]
async fn late_preview_cannot_overwrite_a_final_and_stop_cancels_pending_request() {
    let token = CancellationToken::new();
    let (final_tx, final_rx) = mpsc::channel(4);
    let (preview_tx, preview_rx) = watch::channel(Some(sentence(1, 1, "Early partial", false)));
    let emitted = Mutex::new(Vec::new());
    let skipped = AtomicU64::new(0);
    let (completed_tx, mut completed_rx) = mpsc::unbounded_channel();
    let worker = translate_updates(
        &token,
        final_rx,
        preview_rx,
        &skipped,
        |s| async move {
            if !s.final_text {
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
            Ok("译文".into())
        },
        |s, _| {
            emitted.lock().unwrap().push(s.final_text);
            completed_tx.send(s.final_text).unwrap();
            Ok(())
        },
    );
    let drive = async {
        tokio::task::yield_now().await;
        preview_tx.send_replace(None);
        final_tx
            .send((sentence(1, 2, "Final sentence", true), Instant::now()))
            .await
            .unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(10), completed_rx.recv())
                .await
                .unwrap()
                .unwrap()
        );
        assert_eq!(*emitted.lock().unwrap(), vec![true]);
        preview_tx.send_replace(Some(sentence(2, 1, "Another partial", false)));
        tokio::time::sleep(Duration::from_millis(1500)).await;
        token.cancel();
    };
    let (result, ()) = tokio::join!(worker, drive);
    result.unwrap();
    assert_eq!(*emitted.lock().unwrap(), vec![true]);
}

#[tokio::test(start_paused = true)]
async fn identical_final_reuses_preview_and_stale_finals_are_skipped() {
    let token = CancellationToken::new();
    let (final_tx, final_rx) = mpsc::channel(4);
    let (preview_tx, preview_rx) = watch::channel(Some(sentence(1, 1, "Same source", false)));
    let requests = AtomicU64::new(0);
    let skipped = AtomicU64::new(0);
    let (emitted_tx, mut emitted_rx) = mpsc::unbounded_channel();
    let worker = translate_updates(
        &token,
        final_rx,
        preview_rx,
        &skipped,
        |_| {
            requests.fetch_add(1, Ordering::Relaxed);
            async { Ok("相同原文".into()) }
        },
        |s, text| {
            emitted_tx.send((s.final_text, s.revision, text)).unwrap();
            Ok(())
        },
    );
    let drive = async {
        assert_eq!(
            emitted_rx.recv().await.unwrap(),
            (false, 1, "相同原文".into())
        );
        preview_tx.send_replace(None);
        final_tx
            .send((sentence(1, 2, "Same source", true), Instant::now()))
            .await
            .unwrap();
        assert_eq!(
            emitted_rx.recv().await.unwrap(),
            (true, 2, "相同原文".into())
        );
        assert_eq!(requests.load(Ordering::Relaxed), 1);
        final_tx
            .send((
                sentence(2, 1, "Expired source", true),
                Instant::now() - Duration::from_secs(21),
            ))
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert_eq!(skipped.load(Ordering::Relaxed), 1);
        assert_eq!(requests.load(Ordering::Relaxed), 1);
        token.cancel();
    };
    let (result, ()) = tokio::join!(worker, drive);
    result.unwrap();
}
