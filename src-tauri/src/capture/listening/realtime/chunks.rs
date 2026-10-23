use super::Sentence;

#[derive(Default)]
pub(super) struct Chunks {
    remote_id: Option<u64>,
    previous: String,
    consumed: usize,
    next_id: u64,
    live: Option<Sentence>,
    opened_ms: u64,
}

impl Chunks {
    /// Published captions are immutable. Only the uncommitted tail follows ASR revisions.
    pub fn push(&mut self, source: Sentence, now_ms: u64) -> Vec<Sentence> {
        let mut output = Vec::new();
        if self.remote_id.is_some_and(|id| source.id < id) {
            return output;
        }
        if self.remote_id != Some(source.id) {
            if let Some(mut tail) = self.live.take() {
                tail.final_text = true;
                tail.revision += 1;
                output.push(tail);
            }
            self.remote_id = Some(source.id);
            self.previous.clear();
            self.consumed = 0;
            self.opened_ms = now_ms;
        }
        let stable = common_prefix(&self.previous, &source.text);
        self.consumed = remap_boundary(&self.previous, &source.text, self.consumed);
        let stable = stable.saturating_sub(self.consumed);
        let text = source.text.clone();
        let mut tail = &text[self.consumed..];
        let mut stable_remaining = stable;
        loop {
            let leading = tail.len() - tail.trim_start().len();
            self.consumed += leading;
            stable_remaining = stable_remaining.saturating_sub(leading);
            tail = tail.trim_start();
            if tail.is_empty() {
                if let Some(mut live) = self.live.take() {
                    live.revision += 1;
                    live.final_text = true;
                    live.text.clear();
                    output.push(live);
                }
                break;
            }
            if self.live.is_none() {
                self.next_id += 1;
                self.live = Some(Sentence {
                    id: self.next_id,
                    revision: 0,
                    text: String::new(),
                    final_text: false,
                    start_ms: if self.consumed == 0 {
                        source.start_ms
                    } else {
                        now_ms.saturating_sub(500).max(source.start_ms)
                    },
                });
            }
            let cut = cut_at(
                tail,
                stable_remaining,
                now_ms.saturating_sub(self.opened_ms),
                source.final_text,
            );
            let part = &tail[..cut.unwrap_or(tail.len())];
            let live = self.live.as_mut().unwrap();
            live.revision += 1;
            live.text = part.trim().into();
            live.final_text = cut.is_some();
            output.push(live.clone());
            if let Some(cut) = cut {
                self.live = None;
                self.consumed += cut;
                stable_remaining = stable_remaining.saturating_sub(cut);
                tail = &tail[cut..];
                self.opened_ms = now_ms;
            } else {
                break;
            }
        }
        self.previous = text;
        output
    }
}

fn common_prefix(a: &str, b: &str) -> usize {
    a.chars()
        .zip(b.chars())
        .take_while(|(a, b)| a == b)
        .map(|(c, _)| c.len_utf8())
        .sum()
}

fn cjk(c: char) -> bool {
    matches!(c, '\u{3400}'..='\u{9fff}' | '\u{3040}'..='\u{30ff}' | '\u{ac00}'..='\u{d7af}')
}

fn cut_at(text: &str, stable: usize, elapsed: u64, final_text: bool) -> Option<usize> {
    let chars: Vec<_> = text.char_indices().collect();
    let cjk_text = chars.iter().filter(|(_, c)| cjk(*c)).count() > chars.len() / 3;
    let limit = if cjk_text { 32 } else { 100 };
    let mut words = 0;
    let mut whitespace = None;
    for (n, (i, c)) in chars.iter().copied().enumerate() {
        let end = i + c.len_utf8();
        if c.is_whitespace() {
            whitespace = Some(end);
            words += 1;
        }
        let sentence_end = matches!(c, '。' | '！' | '？' | '!' | '?' | ';' | '；')
            || (c == '.' && {
                let before = text[..i].split_whitespace().last().unwrap_or("");
                let decimal = chars
                    .get(n.wrapping_sub(1))
                    .is_some_and(|(_, c)| c.is_ascii_digit())
                    && chars.get(n + 1).is_some_and(|(_, c)| c.is_ascii_digit());
                !decimal
                    && !["Mr", "Mrs", "Ms", "Dr", "Prof", "St", "e.g", "i.e"].contains(&before)
                    && (end == text.len()
                        || chars.get(n + 1).is_some_and(|(_, c)| c.is_whitespace()))
            });
        if sentence_end && n >= 3 {
            return Some(end);
        }
        if n + 1 >= limit || words >= 16 {
            return Some(if cjk_text {
                end
            } else {
                whitespace.filter(|cut| *cut >= 20).unwrap_or(end)
            });
        }
    }
    if final_text {
        return Some(text.len());
    }
    if elapsed >= 1200 && stable >= 12 {
        let end = stable.min(text.len());
        if cjk_text {
            return Some(end);
        }
        if let Some((i, c)) = text[..end]
            .char_indices()
            .rev()
            .find(|(_, c)| c.is_whitespace())
        {
            if i >= 12 {
                return Some(i + c.len_utf8());
            }
        }
    }
    None
}

#[derive(Clone)]
struct Token<'a> {
    text: &'a str,
    end: usize,
}
fn tokens(text: &str) -> Vec<Token<'_>> {
    let mut result = Vec::new();
    let mut word = None;
    for (i, c) in text.char_indices() {
        if c.is_alphanumeric() && !cjk(c) || c == '\'' {
            word.get_or_insert(i);
        } else {
            if let Some(start) = word.take() {
                result.push(Token {
                    text: &text[start..i],
                    end: i,
                });
            }
            if !c.is_whitespace() {
                result.push(Token {
                    text: &text[i..i + c.len_utf8()],
                    end: i + c.len_utf8(),
                });
            }
        }
    }
    if let Some(start) = word {
        result.push(Token {
            text: &text[start..],
            end: text.len(),
        });
    }
    result
}

/// Map the frozen boundary across upstream corrections; never replay the published prefix.
fn remap_boundary(old: &str, new: &str, cut: usize) -> usize {
    if cut == 0 {
        return 0;
    }
    if new.starts_with(&old[..cut]) {
        return cut;
    }
    let old = tokens(old);
    let new_tokens = tokens(new);
    let boundary = old.iter().take_while(|t| t.end <= cut).count();
    if boundary == 0 || new_tokens.is_empty() {
        return 0;
    }
    // Common corrections align cheaply using a short anchor around the frozen boundary.
    for size in (2..=boundary.min(8)).rev() {
        let anchor = &old[boundary - size..boundary];
        let found = new_tokens
            .windows(size)
            .enumerate()
            .filter(|(_, window)| window.iter().zip(anchor).all(|(a, b)| a.text == b.text))
            .min_by_key(|(i, _)| (i + size).abs_diff(boundary));
        if let Some((_, window)) = found {
            return window.last().unwrap().end;
        }
    }
    // A linear-memory edit alignment also handles revisions of the boundary words themselves.
    let mut costs: Vec<usize> = (0..=new_tokens.len()).collect();
    let mut mapped = vec![0; new_tokens.len() + 1];
    let mut next = vec![0; new_tokens.len() + 1];
    let mut next_map = vec![0; new_tokens.len() + 1];
    for (i, a) in old.iter().enumerate() {
        let row = i + 1;
        next[0] = row;
        next_map[0] = 0;
        for (j, b) in new_tokens.iter().enumerate() {
            let col = j + 1;
            let diagonal = costs[j] + usize::from(a.text != b.text);
            let deletion = costs[col] + 1;
            let insertion = next[j] + 1;
            if diagonal <= deletion && diagonal <= insertion {
                next[col] = diagonal;
                next_map[col] = if row == boundary { col } else { mapped[j] };
            } else if deletion <= insertion {
                next[col] = deletion;
                next_map[col] = if row == boundary { col } else { mapped[col] };
            } else {
                next[col] = insertion;
                next_map[col] = next_map[j];
            }
        }
        std::mem::swap(&mut costs, &mut next);
        std::mem::swap(&mut mapped, &mut next_map);
    }
    mapped
        .last()
        .and_then(|n| n.checked_sub(1))
        .map(|i| new_tokens[i].end)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests;
