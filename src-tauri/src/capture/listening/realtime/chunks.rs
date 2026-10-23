use super::Sentence;

#[derive(Default)]
pub(super) struct Chunks {
    remote_id: Option<u64>,
    previous: String,
    consumed: usize,
    next_id: u64,
    live: Option<Sentence>,
    opened_ms: u64,
    carry: String,
    updated_ms: u64,
    provider_final: bool,
    last_start_ms: u64,
}

impl Chunks {
    /// Published captions are immutable. Only the uncommitted tail follows ASR revisions.
    pub fn push(&mut self, source: Sentence, now_ms: u64) -> Vec<Sentence> {
        let mut output = Vec::new();
        if self.remote_id.is_some_and(|id| source.id < id) {
            return output;
        }
        if self.remote_id != Some(source.id) {
            self.carry = self
                .live
                .as_ref()
                .map(|tail| tail.text.clone())
                .unwrap_or_default();
            if dangling(&self.carry) {
                self.carry = self.carry.trim_end_matches('.').into();
            }
            self.remote_id = Some(source.id);
            self.previous = self.carry.clone();
            self.consumed = 0;
            if self.live.is_none() {
                self.opened_ms = now_ms;
            }
        }
        self.updated_ms = now_ms;
        self.provider_final = source.final_text;
        let combined = if self.carry.is_empty() {
            source.text.clone()
        } else {
            format!(
                "{}{}{}",
                self.carry,
                if self.carry.chars().last().is_some_and(cjk)
                    && source.text.chars().next().is_some_and(cjk)
                {
                    ""
                } else {
                    " "
                },
                source.text
            )
        };
        let stable = common_prefix(&self.previous, &combined);
        self.consumed = remap_boundary(&self.previous, &combined, self.consumed);
        let stable = stable.saturating_sub(self.consumed);
        let text = combined;
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
                let candidate = if self.consumed == 0 {
                    source.start_ms
                } else {
                    now_ms.saturating_sub(500).max(source.start_ms)
                };
                self.last_start_ms = candidate.max(self.last_start_ms);
                self.live = Some(Sentence {
                    id: self.next_id,
                    revision: 0,
                    text: String::new(),
                    final_text: false,
                    start_ms: self.last_start_ms,
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

    /// Only a provider-final tail may be committed after a clean end-of-stream.
    pub fn finish(&mut self) -> Vec<Sentence> {
        self.flush(u64::MAX)
    }

    /// A brief final pause lets a following provider fragment complete a price or phrase.
    pub fn flush(&mut self, now_ms: u64) -> Vec<Sentence> {
        let Some(live) = self.live.as_ref() else {
            return Vec::new();
        };
        let quiet = now_ms.saturating_sub(self.updated_ms);
        let wait = if dangling(&live.text) { 2800 } else { 900 };
        if !self.provider_final || quiet < wait {
            return Vec::new();
        }
        let mut live = self.live.take().unwrap();
        live.revision += 1;
        live.final_text = true;
        self.consumed = self.previous.len();
        self.opened_ms = now_ms;
        vec![live]
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

fn dangling(text: &str) -> bool {
    let last = text
        .trim_end_matches(|c: char| c.is_ascii_punctuation() || c.is_whitespace())
        .split_whitespace()
        .last()
        .unwrap_or("")
        .to_lowercase();
    [
        "a", "an", "the", "to", "of", "in", "on", "at", "for", "with", "and", "or", "but",
        "that's", "these", "those", "this", "that", "my", "your", "his", "her", "their", "hundred",
        "thousand", "million", "billion",
    ]
    .contains(&last.as_str())
        || (!last.is_empty()
            && last
                .chars()
                .all(|c| c.is_ascii_digit() || c == '.' || c == ','))
}

fn cut_at(text: &str, stable: usize, elapsed: u64, _final_text: bool) -> Option<usize> {
    let chars: Vec<_> = text.char_indices().collect();
    let cjk_text = chars.iter().filter(|(_, c)| cjk(*c)).count() > chars.len() / 3;
    let soft = if cjk_text { 40 } else { 120 };
    let hard = if cjk_text { 80 } else { 260 };
    let mut clause = None;
    let mut word_boundary = None;
    for (n, (i, c)) in chars.iter().copied().enumerate() {
        let end = i + c.len_utf8();
        let prefix = &text[..end];
        let strong = matches!(c, '。' | '！' | '？' | '!' | '?' | ';' | '；')
            || (c == '.' && {
                let before = text[..i].split_whitespace().last().unwrap_or("");
                let decimal = chars
                    .get(n.wrapping_sub(1))
                    .is_some_and(|(_, c)| c.is_ascii_digit())
                    && chars.get(n + 1).is_some_and(|(_, c)| c.is_ascii_digit());
                !decimal
                    && ![
                        "Mr", "Mrs", "Ms", "Dr", "Prof", "St", "e.g", "i.e", "U.S", "U.K",
                    ]
                    .contains(&before)
                    && (end == text.len()
                        || chars.get(n + 1).is_some_and(|(_, c)| c.is_whitespace()))
            });
        if strong && n >= 3 && !dangling(prefix) {
            return Some(end);
        }
        if c.is_whitespace() && !dangling(prefix) && n >= soft {
            word_boundary = Some(end);
        }
        if n >= soft
            && (matches!(c, ',' | '，' | '、' | ':' | '：')
                || c.is_whitespace()
                    && ["and ", "but ", "while ", "although ", "because ", "so "]
                        .iter()
                        .any(|word| text[end..].starts_with(word)))
            && !dangling(prefix)
        {
            clause = Some(end);
            if end <= stable && elapsed >= 2500 {
                return clause;
            }
        }
        if n + 1 >= hard {
            return Some(clause.or(word_boundary).unwrap_or(end));
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
