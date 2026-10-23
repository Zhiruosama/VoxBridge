use super::*;
use futures_util::{stream::FuturesUnordered, StreamExt};
use std::future::Future;

pub(super) async fn translate_chunks<F, Fut, E>(
    token: &CancellationToken,
    mut queue: mpsc::Receiver<Sentence>,
    mut translate: F,
    mut emit: E,
) -> Result<(), String>
where
    F: FnMut(Sentence) -> Fut,
    Fut: Future<Output = Result<String, String>>,
    E: FnMut(Sentence, Result<String, String>) -> Result<(), String>,
{
    let mut pending = FuturesUnordered::new();
    let mut closed = false;
    loop {
        if closed && pending.is_empty() {
            return Ok(());
        }
        tokio::select! { biased;
            _ = token.cancelled() => return Ok(()),
            result = pending.next(), if !pending.is_empty() => {
                let (sentence, text): (Sentence, Result<String, String>) = result.unwrap();
                if let Err(error) = &text {
                    if error != crate::providers::INVALID_TRANSLATION { return Err(error.clone()); }
                }
                if !token.is_cancelled() { emit(sentence, text)?; }
            },
            next = queue.recv(), if !closed && pending.len()<3 => {
                if let Some(sentence) = next {
                    let request = translate(sentence.clone());
                    pending.push(async move { (sentence, request.await) });
                } else { closed = true; }
            },
        }
    }
}

#[cfg(test)]
mod tests;
