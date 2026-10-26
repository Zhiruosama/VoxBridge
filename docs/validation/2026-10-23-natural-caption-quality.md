# Natural captions, independent direction and validated translations

[验证索引](README.md) · [当前使用指南](../user-guide.md)

> 历史验证记录：仅说明记录日期的测试范围，不代表所有平台、客户端或后续构建均通过。

The screenshot exposed three independent defects: the 1.2-second stable-prefix cutter finalized grammatically unfinished phrases; the listener reused the text composer's language pair (Chinese → English while hearing English); and any nonempty model response was rendered as a translation, including an English explanation about translation being unnecessary.

## Behavior

- Removed arbitrary timer-based word slicing. Sentence punctuation is preferred. Longer continuous speech can cut at a clause boundary after about 120 Latin / 40 CJK characters, with a 260 / 80 character safety bound. Existing published captions remain immutable and new work stays limited to the uncommitted tail.
- A provider sentence boundary no longer automatically commits an unfinished phrase. Its tail can carry into the next provider result, so `Fifteen million` + `dollar house.` becomes one caption. Number-ending phrases wait up to 2.8 seconds for continuation; ordinary final tails flush after 900 ms of quiet. A 200-ms task timer performs this flush even without new ASR text. Raw ASR updates use a bounded channel to the segmentation task. VAD silence threshold is now 650 ms. Local caption timestamps never go backwards; they remain approximate without word-level timing.
- Listening has independent persisted settings, defaulting to `自动识别 → 简体中文`. Old text-expression language preferences remain unchanged; newly created expression settings default to Chinese → English. General settings now expose expression input/output languages. Auto-listening uses those expression preferences for replies; an explicitly chosen listening source still supports reverse-direction replies.
- Translation instructions detect actual source language and treat the configured source only as a hint. Output validation detects explanatory commentary, common English echoes instead of Chinese translation, target-script mismatches and excessive expansion. Suspect output is retried once with a stricter translation-only instruction. If still invalid, only that caption receives a small failure marker; later captions continue and no raw explanatory response is displayed. This is a bounded heuristic, not a semantic quality guarantee for every supported language.

## Validation

- Frontend: 83 tests passed. Rust: 89 passed, 16 opt-in tests ignored. New regressions include the exact house-video excerpt, preserving its opening sentence, merging the amount/unit phrase across provider IDs, quiet-tail flushing, timestamp monotonicity, language-setting migration, automatic/manual duplex directions, per-caption invalid-output isolation, and local HTTP tests for actual retry payloads and sanitized repeated failure.
- **Real DeepSeek Flash:** Explicitly invoked `live_flash_translates_screenshot_captions_into_chinese` with the user-provided ignored workspace test-key file. Five requests using `deepseek-flash` and disabled thinking all returned Chinese, with no English echo or explanatory prose. Individual observed request times: 1078, 812, 632, 809 and 838 ms. These are translation-request timings, not full ASR/capture latency. No Keychain access or credential-prompt flow was used.
- Actual Rust chunker replay emitted five coherent captions from the screenshot excerpt. The isolated UI displayed those emitted records paired with the **real service replies**, rather than handwritten translation fixtures. Screenshot: `native/macos/.build/natural-captions-real-flash.png` (ignored).
- Production frontend and Mac app bundle builds, formatting, diff checks, Clippy with warnings denied and strict deep codesign verification passed.
- Live Chrome audio/ASR was not replayed during this batch, and the existing app session was not restarted. The real-model text test verifies response language and the recorded excerpt; semantic accuracy and broader listening experience still require interactive acceptance.
