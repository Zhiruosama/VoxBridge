# Floating caption colors

[验证索引](README.md) · [当前使用指南](../user-guide.md)

> 历史验证记录：仅说明记录日期的测试范围，不代表所有平台、客户端或后续构建均通过。

- Floating captions default to the workspace's recognition/expression colors. Existing settings without a color mode adopt this default; the previous independent color remains stored for switching back to custom mode.
- Settings → General → Floating captions offers workspace or custom colors. Custom mode supports six swatches and any six-digit RGB color. Original text is dimmed within the chosen hue; translations retain the full color.
- Saving workspace colors or floating appearance republishes the bounded snapshot, including colors for existing lines. No reopen or new caption is needed. Settings persist across reload.
- Frontend tests: 113 passed. Native overlay tests: 8 passed, including legacy snapshot compatibility and strict color validation. Production build, formatting, Clippy with warnings denied and signed macOS app/microphone-entitlement verification passed.
- UI verification used the real App and SubtitleOverlay with simulated captions/providers: recognition cyan and expression orange appeared in both views; custom yellow recolored both existing floating rows; switching back restored their respective colors. Reload retained the selected mode and previously saved custom color. No live provider request or microphone recording was used.
- Screenshot: local ignored `native/macos/.build/overlay-colors-synced.png`.
