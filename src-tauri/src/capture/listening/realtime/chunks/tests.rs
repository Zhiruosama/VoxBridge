use super::*;
fn input(revision: u32, text: &str, final_text: bool) -> Sentence {
    Sentence {
        id: 1,
        revision,
        text: text.into(),
        final_text,
        start_ms: 0,
    }
}

#[test]
fn completed_sentences_are_frozen_and_final_flushes_only_new_tail() {
    let mut chunks = Chunks::default();
    let first = chunks.push(
        input(
            1,
            "These chairs are massage chairs. Wait, what? There is also",
            false,
        ),
        0,
    );
    assert_eq!(
        first
            .iter()
            .filter(|s| s.final_text)
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>(),
        vec!["These chairs are massage chairs.", "Wait, what?"]
    );
    let tail_id = first.last().unwrap().id;
    let next = chunks.push(
        input(
            2,
            "These chairs are massage chairs. Wait, what? There is also an arcade.",
            false,
        ),
        500,
    );
    assert_eq!(next.len(), 1);
    assert_eq!(next[0].id, tail_id);
    assert_eq!(next[0].text, "There is also an arcade.");
    assert!(next[0].final_text);
    assert!(chunks
        .push(
            input(
                3,
                "These chairs are massage chairs. Wait, what? There is also an arcade.",
                true
            ),
            1000
        )
        .is_empty());
}

#[test]
fn bounded_chunks_and_stable_tail_commit_without_waiting_for_provider_final() {
    let mut chunks = Chunks::default();
    chunks.push(
        input(
            1,
            "I was not expecting all these features for one million",
            false,
        ),
        0,
    );
    let next = chunks.push(
        input(
            2,
            "I was not expecting all these features for one million dollars and a lovely house",
            false,
        ),
        1400,
    );
    assert!(next.iter().any(|s| s.final_text));
    assert!(next[0].text.starts_with("I was not expecting"));
    let mut chunks = Chunks::default();
    let long =
        "A very large and comfortable house with a movie theater and an arcade and a water park "
            .repeat(8);
    let output = chunks.push(input(1, &long, true), 0);
    assert!(output.len() > 5);
    assert!(output
        .iter()
        .all(|s| s.final_text && s.text.chars().count() <= 100));
    assert_eq!(
        output
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>()
            .join(" "),
        long.trim()
    );
}

#[test]
fn upstream_corrections_do_not_replay_published_prefix() {
    let mut chunks = Chunks::default();
    chunks.push(
        input(1, "This costs twenty dollars. Now we enter", false),
        0,
    );
    let next = chunks.push(
        input(
            2,
            "This costs thirty dollars. Now we enter the arcade.",
            true,
        ),
        1400,
    );
    assert_eq!(next.len(), 1);
    assert_eq!(next[0].text, "Now we enter the arcade.");
    assert_eq!(
        remap_boundary(
            "A bad idea. The next part",
            "A completely different thought. The next part continues",
            "A bad idea.".len()
        ),
        "A completely different thought.".len()
    );
}

#[test]
fn chinese_decimals_and_titles_have_safe_boundaries() {
    let mut chunks = Chunks::default();
    let output = chunks.push(
        input(1, "这里有电影院。还有按摩椅！接着参观游戏室。", true),
        0,
    );
    assert_eq!(
        output.iter().map(|s| s.text.as_str()).collect::<String>(),
        "这里有电影院。还有按摩椅！接着参观游戏室。"
    );
    let mut chunks = Chunks::default();
    let output = chunks.push(
        input(
            1,
            "Dr. Smith paid 1.5 million dollars. There is a pool.",
            true,
        ),
        0,
    );
    assert_eq!(output[0].text, "Dr. Smith paid 1.5 million dollars.");
}

#[test]
fn new_provider_sentence_seals_previous_tail_with_new_revision() {
    let mut chunks = Chunks::default();
    let first = chunks.push(input(1, "An unfinished thought", false), 0);
    let mut next = input(1, "A new speaker starts", false);
    next.id = 2;
    next.start_ms = 1600;
    let output = chunks.push(next, 1800);
    assert!(output[0].final_text);
    assert_eq!(output[0].id, first[0].id);
    assert!(output[0].revision > first[0].revision);
    assert_ne!(output[0].id, output[1].id);
    assert!(chunks
        .push(input(5, "An unfinished thought but changed", true), 2000)
        .is_empty());
}

#[test]
fn retracted_tail_is_removed_without_removing_completed_caption() {
    let mut chunks = Chunks::default();
    let first = chunks.push(input(1, "A completed sentence. Wrong extra tail", false), 0);
    let output = chunks.push(input(2, "A completed sentence.", true), 500);
    assert_eq!(output.len(), 1);
    assert_eq!(output[0].id, first[1].id);
    assert!(output[0].final_text && output[0].text.is_empty());
    assert_ne!(output[0].id, first[0].id);
}
