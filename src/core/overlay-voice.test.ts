import { expect, it } from 'vitest';
import { newerOverlayVoice, overlayVoiceDefaults } from './overlay-voice';
it('keeps newer recording state when a delayed idle read arrives', () => {
  const current = { ...overlayVoiceDefaults, version: 4, phase: 'recording' as const, level: 0.8 };
  expect(newerOverlayVoice(current, { ...overlayVoiceDefaults, version: 3 })).toBe(current);
  expect(newerOverlayVoice(current, { ...overlayVoiceDefaults, version: 4 })).toBe(current);
  expect(
    newerOverlayVoice(current, { ...overlayVoiceDefaults, version: 5, draft: '保留浮窗草稿' })
      .draft,
  ).toBe('保留浮窗草稿');
});
