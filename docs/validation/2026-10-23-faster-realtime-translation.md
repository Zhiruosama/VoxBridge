# More frequent realtime subtitle translation

[验证索引](README.md) · [当前使用指南](../user-guide.md)

> 历史验证记录：仅说明记录日期的测试范围，不代表所有平台、客户端或后续构建均通过。

This interim implementation was superseded by [stable short caption chunks](2026-10-23-stable-short-captions.md) after interactive testing exposed provisional translation resets and whole-sentence resubmission.

The realtime listening path previously translated only final ASR sentences. Continuous narration could therefore show source text for 10–20 seconds before any translation appeared.

The WebSocket path now has one latest-value slot for interim ASR text, sampled on a 1.5-second cadence. At most one translation request runs at a time. New interim revisions replace the waiting snapshot rather than building a queue. Unchanged text is not translated repeatedly; snapshots shorter than four characters or beyond the existing 2000-character translation limit are not submitted for previews. Final sentences retain their bounded four-item queue and 20-second expiry. A final interrupts an in-flight preview network wait and takes priority; an exact matching completed preview is reused for the final revision.

The ASR run-task request now sets `max_sentence_silence=400` and `multi_threshold_mode_enabled=true`. The official [Qwen streaming client-event reference](https://help.aliyun.com/zh/model-studio/qwen-audio-asr-streaming-client-events) documents the silence threshold range and multi-threshold option to avoid overly long segments. HTTP/file ASR segmentation is unchanged.

Interim translation events include their source snapshot. The frontend accepts them only for an unfinished segment in the active session/generation, when its current text still starts with that snapshot and the result is not older than its displayed translation revision. ASR extensions keep a matching translated prefix visible; textual corrections clear it. A final translation still requires its exact final revision, and late preview events cannot overwrite it. Main and floating subtitles share these updates.

The 1.5-second interval is a scheduling target, not a guaranteed end-to-end latency: model/network response time and final work still apply. Interim text may change before finalization. More frequent previews can increase translation request volume; coalescing, deduplication, exact-final reuse and cancellation bound unnecessary work.

## Validation

- Frontend: 78 tests passed, including interim prefix acceptance, correction rejection, final replacement, old-revision/session isolation and existing recovery behavior.
- Rust: 76 tests passed; 15 opt-in hardware/service tests ignored. Paused-clock tests verify 50 revisions coalesce to the latest snapshot at the next cadence, unchanged text is not repeated, a final preempts a three-second preview wait, cancellation suppresses pending output, identical finals reuse completed translations, and expired finals are skipped.
- The local mocked WebSocket test verifies the new ASR run-task parameters as well as partial/final protocol ordering.
- Frontend production build, formatting, diff check, Clippy with warnings denied, Rust formatting and Mac app bundle/signature verification passed.
- No credentials were accessed, no paid service calls were made, and the user's running listening session was not restarted. Real video playback latency and translation quality need interactive acceptance after restarting the new build.
