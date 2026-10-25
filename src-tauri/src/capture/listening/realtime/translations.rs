use super::*;
use futures_util::{stream::FuturesUnordered, StreamExt};
use std::{collections::VecDeque, future::Future};
use tokio::time::Instant;

pub(super) struct QueuedCaption {
    sentence: Sentence,
    queued: Instant,
    context: crate::providers::TranslationContext,
}
impl From<Sentence> for QueuedCaption {
    fn from(sentence: Sentence) -> Self {
        Self::new(sentence, crate::providers::TranslationContext::default())
    }
}

impl QueuedCaption {
    pub(super) fn new(sentence: Sentence, context: crate::providers::TranslationContext) -> Self {
        Self {
            sentence,
            queued: Instant::now(),
            context,
        }
    }
}

#[derive(Default)]
struct Measurements {
    samples: VecDeque<[u64; 3]>,
    completed: u64,
    failed: u64,
}
impl Measurements {
    fn record(&mut self, queue_ms: u64, request_ms: u64, success: bool) {
        self.completed += 1;
        self.failed += u64::from(!success);
        self.samples
            .push_back([queue_ms, request_ms, queue_ms.saturating_add(request_ms)]);
        if self.samples.len() > 128 {
            self.samples.pop_front();
        }
    }
    fn report(&self, queued: usize, inflight: usize) -> TranslationMetrics {
        let percentile = |column, percent: usize| {
            let mut values: Vec<u64> = self.samples.iter().map(|sample| sample[column]).collect();
            values.sort_unstable();
            if values.is_empty() {
                0
            } else {
                values[(values.len() * percent).div_ceil(100) - 1]
            }
        };
        TranslationMetrics {
            completed: self.completed,
            failed: self.failed,
            sample_count: self.samples.len(),
            queued,
            inflight,
            queue_p50_ms: percentile(0, 50),
            queue_p95_ms: percentile(0, 95),
            request_p50_ms: percentile(1, 50),
            request_p95_ms: percentile(1, 95),
            total_p50_ms: percentile(2, 50),
            total_p95_ms: percentile(2, 95),
        }
    }
}

pub(super) async fn translate_chunks<F, Fut, E, M>(
    token: &CancellationToken,
    mut queue: mpsc::Receiver<QueuedCaption>,
    mut translate: F,
    mut emit: E,
    mut metrics: M,
) -> Result<(), String>
where
    F: FnMut(Sentence, crate::providers::TranslationContext) -> Fut,
    Fut: Future<Output = Result<String, String>>,
    E: FnMut(Sentence, Result<String, String>) -> Result<(), String>,
    M: FnMut(TranslationMetrics) -> Result<(), String>,
{
    let mut pending = FuturesUnordered::new();
    let mut closed = false;
    let mut measurements = Measurements::default();
    loop {
        if closed && pending.is_empty() {
            return Ok(());
        }
        tokio::select! { biased;
            _ = token.cancelled() => return Ok(()),
            result = pending.next(), if !pending.is_empty() => {
                let (sentence, text, queue_ms, request_ms): (Sentence, Result<String, String>, u64, u64) = result.unwrap();
                measurements.record(queue_ms, request_ms, text.is_ok());
                if !token.is_cancelled() { metrics(measurements.report(queue.len(), pending.len()))?; }
                if let Err(error) = &text {
                    if !crate::providers::is_invalid_translation(error) { return Err(error.clone()); }
                }
                if !token.is_cancelled() { emit(sentence, text)?; }
            },
            next = queue.recv(), if !closed && pending.len()<3 => {
                if let Some(queued) = next {
                    let queue_ms = queued.queued.elapsed().as_millis() as u64;
                    let sentence = queued.sentence;
                    let request = translate(sentence.clone(), queued.context);
                    pending.push(async move {
                        let started = Instant::now();
                        let text = request.await;
                        (sentence, text, queue_ms, started.elapsed().as_millis() as u64)
                    });
                    metrics(measurements.report(queue.len(), pending.len()))?;
                } else { closed = true; }
            },
        }
    }
}

#[cfg(test)]
mod tests;
