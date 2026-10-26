# Content-only text selection

[验证索引](README.md) · [当前使用指南](../user-guide.md)

> 历史验证记录：仅说明记录日期的测试范围，不代表所有平台、客户端或后续构建均通过。

- App chrome does not participate in text selection. Subtitle source/translation paragraphs, diagnostic feedback, error messages and toast text remain selectable.
- Inputs and textareas allow native selection while focused. Global Cmd+A / Ctrl+A outside editors targets only the subtitle feed, excluding the composer and app controls; an empty feed leaves no selection.
- The same selection boundary applies to the floating subtitle window. Native editor shortcuts and IME composition are left intact.

## Validation

- 74 frontend tests passed; production build, formatting and diff checks passed.
- Mac application bundle built; strict deep signature verification passed.
- Isolated desktop IPC browser harness: after clicking workspace blank space, Cmd+A selected exactly the original and translated subtitle paragraphs, excluding timestamps, labels, navigation and input text. Sidebar and inactive textarea computed selection styles were `none`.
- Focused input Cmd+A selected characters 0–11 of its 11-character value and computed selection style was `text`.
- Screenshot: `native/macos/.build/text-selection.png` (ignored artifact).
- No real credentials or services were accessed. The running application was left intact to preserve session credentials.
