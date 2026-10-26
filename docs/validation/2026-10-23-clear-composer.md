# Clear input after successful send

[验证索引](README.md) · [当前使用指南](../user-guide.md)

> 历史验证记录：仅说明记录日期的测试范围，不代表所有平台、客户端或后续构建均通过。

- Successful speech output to the send device clears the submitted input; Enter uses the same completion path.
- Translation-only and preview operations preserve the input. Failure, cancellation, and rejected concurrent operations do not clear it.
- Completed bilingual captions remain visible. The completion handler only clears text matching its submitted snapshot, preserving any newer draft.

Validation: 74 frontend tests passed; production build, formatting, diff and Mac bundle signature checks passed. An isolated mocked desktop UI verified translation and preview preserving input, successful sending clearing it while retaining captions, and failed sending preserving input. No real API or audio output was used. Screenshot: `native/macos/.build/composer-cleared.png` (ignored). The running app was not restarted.
