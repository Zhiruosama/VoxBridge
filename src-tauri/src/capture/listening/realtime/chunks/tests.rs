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
fn stable_text_waits_for_a_complete_thought_instead_of_timer_word_slices() {
    let mut chunks = Chunks::default();
    chunks.push(input(1, "Pretty fun house to live", false), 0);
    let next = chunks.push(
        input(
            2,
            "Pretty fun house to live in, but of course we're all here to see the",
            false,
        ),
        1400,
    );
    assert!(next.iter().all(|s| !s.final_text));
    let complete = chunks.push(input(3, "Pretty fun house to live in, but of course we're all here to see the richest of the rich.", true), 2200);
    assert_eq!(complete.iter().filter(|s| s.final_text).count(), 1);
    assert_eq!(
        complete[0].text,
        "Pretty fun house to live in, but of course we're all here to see the richest of the rich."
    );
    let mut chunks = Chunks::default();
    let long =
        "A very large and comfortable house with a movie theater and an arcade and a water park "
            .repeat(8);
    let mut output: Vec<_> = chunks
        .push(input(1, &long, true), 0)
        .into_iter()
        .filter(|s| s.final_text)
        .collect();
    output.extend(chunks.flush(1000));
    assert!(output.len() >= 3 && output.len() < 8);
    assert!(output
        .iter()
        .all(|s| s.final_text && s.text.chars().count() <= 260));
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
fn upstream_final_corrects_caption_in_place_without_replaying_published_prefix() {
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
    assert_eq!(next.len(), 2);
    assert_eq!(next[0].id, 1);
    assert_eq!(next[0].text, "This costs thirty dollars.");
    assert!(chunks.is_correction(&next[0]));
    assert_eq!(next[1].text, "Now we enter the arcade.");
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
fn provider_fragments_merge_numbers_with_units_and_keep_caption_identity() {
    let mut chunks = Chunks::default();
    let first = chunks.push(input(1, "Fifteen million", true), 0);
    assert!(first.iter().all(|s| !s.final_text));
    assert!(chunks.flush(1000).is_empty());
    let mut next = input(1, "dollar house.", true);
    next.id = 2;
    next.start_ms = 500;
    let output = chunks.push(next, 700);
    assert_eq!(output.len(), 1);
    assert!(output[0].final_text);
    assert_eq!(output[0].text, "Fifteen million dollar house.");
    assert_eq!(output[0].id, first[0].id);
    assert!(output[0].revision > first[0].revision);
    assert!(chunks
        .push(input(5, "Fifteen million changed", true), 900)
        .is_empty());
}

#[test]
fn quiet_final_tail_eventually_flushes_without_waiting_for_more_audio() {
    let mut chunks = Chunks::default();
    let first = chunks.push(input(1, "Thanks for joining us", true), 0);
    assert!(!first[0].final_text);
    assert!(chunks.flush(600).is_empty());
    let output = chunks.flush(1000);
    assert_eq!(output.len(), 1);
    assert!(output[0].final_text);
    assert_eq!(output[0].text, "Thanks for joining us");
    assert!(chunks.flush(2000).is_empty());
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

#[test]
fn provider_price_punctuation_does_not_force_an_isolated_number_caption() {
    let mut chunks = Chunks::default();
    assert!(chunks
        .push(input(1, "Fifteen million.", true), 0)
        .iter()
        .all(|s| !s.final_text));
    let mut next = input(1, "dollar house.", true);
    next.id = 2;
    let output = chunks.push(next, 600);
    assert_eq!(output[0].text, "Fifteen million dollar house.");
    assert!(output[0].final_text);
}

#[test]
fn local_caption_timestamps_never_go_backwards_after_provider_transition() {
    let mut chunks = Chunks::default();
    let mut first = input(1, "There is a room. There is a pool.", true);
    first.start_ms = 10000;
    let mut output = chunks.push(first, 14000);
    let mut next = input(1, "A new view.", true);
    next.id = 2;
    next.start_ms = 11000;
    output.extend(chunks.push(next, 15000));
    assert!(output
        .windows(2)
        .all(|pair| pair[0].start_ms <= pair[1].start_ms));
}

#[test]
fn screenshot_house_excerpt_replays_as_coherent_captions() {
    let mut chunks = Chunks::default();
    let mut captions = Vec::new();
    let timeline=[
        (1,1,"Pretty fun house to live",false,0),
        (1,2,"Pretty fun house to live in, but of course we're all here to see the",false,1400),
        (1,3,"Pretty fun house to live in, but of course we're all here to see the richest of the rich.",true,3000),
        (2,1,"And that's why up next we have the fifteen million",false,3400),
        (2,2,"And that's why up next we have the fifteen million",true,4000),
        (3,1,"dollar house.",true,4500),
        (4,1,"Are you pushing it?",true,5000),
        (5,1,"Oh my God, geez, man. I don't belong here.",true,6000),
    ];
    for (id, revision, text, final_text, now) in timeline {
        let mut event = input(revision, text, final_text);
        event.id = id;
        event.start_ms = now;
        captions.extend(
            chunks
                .push(event, now)
                .into_iter()
                .filter(|s| s.final_text && !s.text.is_empty()),
        );
    }
    assert_eq!(captions.len(), 5);
    assert_eq!(
        captions[0].text,
        "Pretty fun house to live in, but of course we're all here to see the richest of the rich."
    );
    assert_eq!(
        captions[1].text,
        "And that's why up next we have the fifteen million dollar house."
    );
    assert_eq!(captions[2].text, "Are you pushing it?");
    println!("CAPTION_REPLAY:{}",serde_json::to_string(&captions.iter().map(|s|serde_json::json!({"id":s.id,"revision":s.revision,"source":s.text,"startMs":s.start_ms})).collect::<Vec<_>>()).unwrap());
}

#[test]
fn clean_eof_commits_only_provider_final_tail_once() {
    let mut chunks = Chunks::default();
    let source = Sentence {
        id: 1,
        revision: 1,
        text: "Fifteen million".into(),
        final_text: true,
        start_ms: 0,
    };
    chunks.push(source, 100);
    let final_tail = chunks.finish();
    assert_eq!(final_tail.len(), 1);
    assert!(final_tail[0].final_text);
    assert_eq!(final_tail[0].text, "Fifteen million");
    assert!(chunks.finish().is_empty());
    let mut unconfirmed = Chunks::default();
    unconfirmed.push(
        Sentence {
            id: 1,
            revision: 1,
            text: "unfinished hypothesis".into(),
            final_text: false,
            start_ms: 0,
        },
        100,
    );
    assert!(unconfirmed.finish().is_empty());
}

#[test]
fn provider_final_reconciles_price_even_after_intermediate_revision() {
    let mut chunks = Chunks::default();
    let first = chunks.push(input(1, "The price is fifteen dollars.", false), 0);
    let id = first[0].id;
    assert!(first[0].final_text);
    // No churn for partial corrections: wait for the provider to confirm them.
    assert!(chunks
        .push(input(2, "The price is fifty dollars.", false), 300)
        .is_empty());
    let final_result = chunks.push(input(3, "The price is fifty dollars.", true), 600);
    assert_eq!(final_result.len(), 1);
    assert_eq!(final_result[0].id, id);
    assert_eq!(final_result[0].text, "The price is fifty dollars.");
    assert!(final_result[0].revision > first[0].revision);
    assert!(chunks.is_correction(&final_result[0]));
    assert_eq!(chunks.corrected_captions, 1);
    assert_eq!(chunks.final_disagreements, 1);
    assert!(chunks
        .push(input(4, "The price is fifty dollars.", true), 900)
        .is_empty());
}

#[test]
fn corrections_are_bounded_and_do_not_touch_previous_provider_utterances() {
    let mut chunks = Chunks::default();
    let old = "The price is fifteen dollars. ".repeat(12);
    chunks.push(input(1, &old, false), 0);
    assert_eq!(chunks.published.len(), 8);
    let corrected = chunks.push(input(2, &old.replace("fifteen", "fifty"), true), 1000);
    assert_eq!(corrected.len(), 8);
    assert!(corrected
        .iter()
        .all(|s| s.id > 4 && s.text == "The price is fifty dollars."));
    let mut next = input(1, "A new sentence.", false);
    next.id = 2;
    chunks.push(next, 1200);
    assert_eq!(chunks.published.len(), 1);
    assert!(chunks
        .push(input(3, "The price was wrong.", true), 1400)
        .is_empty());
}

#[test]
fn a_retracted_published_tail_is_explicitly_removed() {
    let mut chunks = Chunks::default();
    let first = chunks.push(
        input(1, "A real sentence. A hallucinated sentence.", false),
        0,
    );
    let corrected = chunks.push(input(2, "A real sentence.", true), 1000);
    assert_eq!(corrected.len(), 1);
    assert_eq!(corrected[0].id, first[1].id);
    assert!(corrected[0].text.is_empty());
    assert!(chunks.is_correction(&corrected[0]));
}
