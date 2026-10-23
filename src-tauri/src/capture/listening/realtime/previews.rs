use super::*;
use std::future::Future;
use tokio::sync::watch;

/// One request at a time: finals have priority; interim revisions share one latest-value slot.
pub(super) async fn translate_updates<F, Fut, E>(
    token: &CancellationToken,
    mut finals: mpsc::Receiver<(Sentence, Instant)>,
    previews: watch::Receiver<Option<Sentence>>,
    skipped: &AtomicU64,
    mut translate: F,
    mut emit: E,
) -> Result<(), String>
where
    F: FnMut(Sentence) -> Fut,
    Fut: Future<Output = Result<String, String>>,
    E: FnMut(Sentence, String) -> Result<(), String>,
{
    let mut cadence = tokio::time::interval(Duration::from_millis(1500));
    cadence.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_preview: Option<(u64, String)> = None;
    let mut last_result: Option<(u64, String, String)> = None;
    let mut pending_final = None;
    loop {
        if token.is_cancelled() {
            return Ok(());
        }
        let sentence = if let Some(sentence) = pending_final.take() {
            sentence
        } else {
            tokio::select! { biased;
                _ = token.cancelled() => return Ok(()),
                final_sentence = finals.recv() => {
                    let Some((sentence, created)) = final_sentence else { return Ok(()); };
                    (sentence, created)
                },
                _ = cadence.tick() => {
                    let Some(sentence) = previews.borrow().clone() else { continue; };
                    if sentence.text.chars().count() < 4 || sentence.text.chars().count() > 2000
                        || last_preview.as_ref().is_some_and(|(id, text)| *id == sentence.id && *text == sentence.text) {
                        continue;
                    }
                    last_preview = Some((sentence.id, sentence.text.clone()));
                    (sentence, Instant::now())
                },
            }
        };
        let (sentence, created) = sentence;
        if created.elapsed() > Duration::from_secs(20) {
            skipped.fetch_add(1, Ordering::Relaxed);
            continue;
        }
        if sentence.final_text {
            if let Some((id, source, text)) = &last_result {
                if *id == sentence.id && *source == sentence.text {
                    emit(sentence, text.clone())?;
                    continue;
                }
            }
        }
        let text = tokio::select! { biased;
            _ = token.cancelled() => return Ok(()),
            next_final = finals.recv(), if !sentence.final_text => {
                let Some(next_final) = next_final else { return Ok(()); };
                // Dropping the interim request future aborts its network wait without
                // cancelling the shared listening session or a queued final.
                pending_final = Some(next_final);
                continue;
            },
            result = translate(sentence.clone()) => result?,
        };
        last_result = Some((sentence.id, sentence.text.clone(), text.clone()));
        // A completed ASR sentence supersedes any in-flight interim translation.
        if !sentence.final_text
            && previews
                .borrow()
                .as_ref()
                .is_none_or(|latest| latest.id != sentence.id)
        {
            continue;
        }
        if !token.is_cancelled() {
            emit(sentence, text)?;
        }
    }
}

#[cfg(test)]
mod tests;
