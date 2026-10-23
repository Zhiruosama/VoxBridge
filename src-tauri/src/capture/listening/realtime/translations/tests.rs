use super::*;
use std::sync::Mutex;

fn caption(id: u64) -> Sentence {
    Sentence {
        id,
        revision: 1,
        text: format!("Short sentence {id}."),
        final_text: true,
        start_ms: 0,
    }
}

#[tokio::test(start_paused = true)]
async fn slow_caption_does_not_block_following_captions_or_get_cancelled_by_them() {
    let token = CancellationToken::new();
    let (tx, rx) = mpsc::channel(32);
    for id in 1..=6 {
        tx.send(caption(id).into()).await.unwrap();
    }
    drop(tx);
    let observed = Mutex::new(Vec::new());
    translate_chunks(
        &token,
        rx,
        |s| async move {
            tokio::time::sleep(Duration::from_millis(if s.id == 1 { 4000 } else { 200 })).await;
            Ok(format!("译文 {}", s.id))
        },
        |s, text| {
            assert_eq!(text.unwrap(), format!("译文 {}", s.id));
            observed.lock().unwrap().push(s.id);
            Ok(())
        },
        |_| Ok(()),
    )
    .await
    .unwrap();
    let results = observed.into_inner().unwrap();
    assert_eq!(results.len(), 6);
    assert_ne!(results[0], 1);
    assert_eq!(results.last(), Some(&1));
}

#[tokio::test(start_paused = true)]
async fn concurrency_is_bounded_and_stop_suppresses_all_pending_results() {
    let token = CancellationToken::new();
    let (tx, rx) = mpsc::channel(32);
    for id in 1..=12 {
        tx.send(caption(id).into()).await.unwrap();
    }
    drop(tx);
    let requests = AtomicU64::new(0);
    let worker = translate_chunks(
        &token,
        rx,
        |_| {
            requests.fetch_add(1, Ordering::Relaxed);
            async {
                tokio::time::sleep(Duration::from_secs(10)).await;
                Ok("结果".into())
            }
        },
        |_, _| panic!("no results after stop"),
        |_| Ok(()),
    );
    let drive = async {
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(requests.load(Ordering::Relaxed), 3);
        token.cancel();
    };
    let (result, ()) = tokio::join!(worker, drive);
    result.unwrap();
    assert_eq!(requests.load(Ordering::Relaxed), 3);
}

#[tokio::test]
async fn invalid_model_reply_is_isolated_to_its_caption_and_later_captions_continue() {
    let token = CancellationToken::new();
    let (tx, rx) = mpsc::channel(32);
    tx.send(caption(1).into()).await.unwrap();
    tx.send(caption(2).into()).await.unwrap();
    drop(tx);
    let events = Mutex::new(Vec::new());
    translate_chunks(
        &token,
        rx,
        |s| async move {
            if s.id == 1 {
                Err(crate::providers::INVALID_TRANSLATION.into())
            } else {
                Ok("正常译文".into())
            }
        },
        |s, result| {
            events.lock().unwrap().push((s.id, result.is_ok()));
            Ok(())
        },
        |_| Ok(()),
    )
    .await
    .unwrap();
    let events = events.into_inner().unwrap();
    assert!(events.contains(&(1, false)) && events.contains(&(2, true)));
}

#[test]
fn latency_percentiles_use_bounded_recent_samples() {
    let mut measurements = Measurements::default();
    for value in 1..=200 {
        measurements.record(value, value * 2, value != 200);
    }
    let metrics = measurements.report(5, 3);
    assert_eq!(metrics.sample_count, 128);
    assert_eq!(metrics.completed, 200);
    assert_eq!(metrics.failed, 1);
    assert_eq!(metrics.queue_p50_ms, 136);
    assert_eq!(metrics.queue_p95_ms, 194);
    assert_eq!(metrics.total_p95_ms, 582);
    assert_eq!((metrics.queued, metrics.inflight), (5, 3));
}

#[tokio::test(start_paused = true)]
async fn measurements_distinguish_queue_wait_from_request_work() {
    let token = CancellationToken::new();
    let (tx, rx) = mpsc::channel(32);
    for id in 1..=4 {
        tx.send(caption(id).into()).await.unwrap();
    }
    drop(tx);
    tokio::time::sleep(Duration::from_millis(100)).await;
    let reports = Mutex::new(Vec::new());
    translate_chunks(
        &token,
        rx,
        |_| async {
            tokio::time::sleep(Duration::from_millis(200)).await;
            Ok("译文".into())
        },
        |_, _| Ok(()),
        |metrics| {
            reports.lock().unwrap().push(metrics);
            Ok(())
        },
    )
    .await
    .unwrap();
    let reports = reports.into_inner().unwrap();
    let last = reports.last().unwrap();
    assert_eq!(last.request_p50_ms, 200);
    assert_eq!(last.queue_p50_ms, 100);
    assert_eq!(last.queue_p95_ms, 300);
    assert_eq!(last.total_p95_ms, 500);
    assert_eq!((last.queued, last.inflight), (0, 0));
}
