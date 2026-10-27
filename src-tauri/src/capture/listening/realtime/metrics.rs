use super::*;
use std::collections::{BTreeMap, VecDeque};

const WINDOW: usize = 128;

#[derive(Default)]
pub(super) struct RecognitionTimings {
    first_partial_ms: Option<u64>,
    first_final_ms: Option<u64>,
    open: BTreeMap<u64, u64>,
    finalization: VecDeque<u64>,
    hold: VecDeque<u64>,
    provider_finals: u64,
    committed: u64,
    last_received_ms: Option<u64>,
}

fn record(values: &mut VecDeque<u64>, value: u64) {
    values.push_back(value);
    if values.len() > WINDOW {
        values.pop_front();
    }
}
fn percentile(values: &VecDeque<u64>, percent: usize) -> u64 {
    let mut sorted: Vec<_> = values.iter().copied().collect();
    sorted.sort_unstable();
    if sorted.is_empty() {
        0
    } else {
        sorted[(sorted.len() * percent).div_ceil(100) - 1]
    }
}

impl RecognitionTimings {
    /// Timestamps are from run start to local receipt, not provider/audio clock estimates.
    pub fn received(&mut self, sentence: &Sentence, received_ms: u64) {
        self.last_received_ms = Some(received_ms);
        if sentence.final_text {
            self.first_final_ms.get_or_insert(received_ms);
            self.provider_finals += 1;
            if let Some(first) = self.open.remove(&sentence.id) {
                record(&mut self.finalization, received_ms.saturating_sub(first));
            }
            self.open.retain(|id, _| *id > sentence.id);
        } else {
            self.first_partial_ms.get_or_insert(received_ms);
            self.open.entry(sentence.id).or_insert(received_ms);
            // The adapter already limits active utterances. Bound instrumentation independently.
            while self.open.len() > 16 {
                self.open.pop_first();
            }
        }
    }
    pub fn committed(&mut self, now_ms: u64) {
        self.committed += 1;
        if let Some(received) = self.last_received_ms {
            record(&mut self.hold, now_ms.saturating_sub(received));
        }
    }
    pub fn report(&self) -> RecognitionMetrics {
        RecognitionMetrics {
            first_partial_ms: self.first_partial_ms,
            first_final_ms: self.first_final_ms,
            provider_finals: self.provider_finals,
            committed_captions: self.committed,
            corrected_captions: 0,
            final_disagreements: 0,
            finalization_samples: self.finalization.len(),
            commit_samples: self.hold.len(),
            partial_to_final_p50_ms: percentile(&self.finalization, 50),
            partial_to_final_p95_ms: percentile(&self.finalization, 95),
            commit_hold_p50_ms: percentile(&self.hold, 50),
            commit_hold_p95_ms: percentile(&self.hold, 95),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sentence(id: u64, final_text: bool) -> Sentence {
        Sentence {
            id,
            revision: 1,
            text: "fixture".into(),
            final_text,
            start_ms: 0,
        }
    }
    #[test]
    fn received_stable_end_and_local_commit_are_distinct_measurements() {
        let mut timings = RecognitionTimings::default();
        timings.received(&sentence(1, false), 500);
        timings.received(&sentence(1, false), 800);
        timings.received(&sentence(1, true), 1400);
        timings.committed(2400);
        let report = timings.report();
        assert_eq!(report.first_partial_ms, Some(500));
        assert_eq!(report.first_final_ms, Some(1400));
        assert_eq!(report.partial_to_final_p95_ms, 900);
        assert_eq!(report.commit_hold_p95_ms, 1000);
        assert_eq!((report.provider_finals, report.committed_captions), (1, 1));
    }
    #[test]
    fn final_only_results_are_not_invented_zero_latency_partial_samples() {
        let mut timings = RecognitionTimings::default();
        timings.received(&sentence(1, true), 1200);
        timings.committed(1200);
        let report = timings.report();
        assert_eq!(report.first_partial_ms, None);
        assert_eq!(report.finalization_samples, 0);
        assert_eq!(report.commit_samples, 1);
        assert_eq!(report.commit_hold_p95_ms, 0);
        assert_eq!(RecognitionTimings::default().report().first_final_ms, None);
    }
    #[test]
    fn instrumentation_is_bounded_and_does_not_store_transcripts() {
        let mut timings = RecognitionTimings::default();
        for id in 1..=200 {
            timings.received(&sentence(id, false), id * 100);
            timings.received(&sentence(id, true), id * 100 + 50);
            timings.committed(id * 100 + 100);
        }
        assert_eq!(timings.report().commit_samples, 128);
        assert_eq!(timings.report().finalization_samples, 128);
        assert_eq!(timings.report().provider_finals, 200);
        for id in 201..=300 {
            timings.received(&sentence(id, false), 30000);
        }
        assert_eq!(timings.open.len(), 16);
    }
}
