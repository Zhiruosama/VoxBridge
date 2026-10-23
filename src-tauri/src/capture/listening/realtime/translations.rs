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
    E: FnMut(Sentence, String) -> Result<(), String>,
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
                let (sentence, text) = result.unwrap()?;
                if !token.is_cancelled() { emit(sentence, text)?; }
            },
            next = queue.recv(), if !closed && pending.len()<3 => {
                if let Some(sentence) = next {
                    let request = translate(sentence.clone());
                    pending.push(async move { request.await.map(|text| (sentence, text)) });
                } else { closed = true; }
            },
        }
    }
}

#[cfg(test)]
mod tests;
