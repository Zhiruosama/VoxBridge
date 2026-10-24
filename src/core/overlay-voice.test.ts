import { expect, it } from 'vitest';
import {
  newerOverlayVoice,
  overlayVoiceDefaults,
  reconcileOverlayDraft,
  restoreOverlayDraft,
} from './overlay-voice';
it('keeps newer recording state when a delayed idle read arrives', () => {
  const current = { ...overlayVoiceDefaults, version: 4, phase: 'recording' as const, level: 0.8 };
  expect(newerOverlayVoice(current, { ...overlayVoiceDefaults, version: 3 })).toBe(current);
  expect(newerOverlayVoice(current, { ...overlayVoiceDefaults, version: 4 })).toBe(current);
  expect(
    newerOverlayVoice(current, { ...overlayVoiceDefaults, version: 5, draft: '保留浮窗草稿' })
      .draft,
  ).toBe('保留浮窗草稿');
});

it('preserves the next typed message through delayed send echoes and completion', () => {
  expect(reconcileOverlayDraft('第二条', '', '第一条', '第一条')).toBe('第二条');
  expect(reconcileOverlayDraft('第二条', '第一条', '', '第一条')).toBe('第二条');
  expect(reconcileOverlayDraft('第一条', '第一条', '', '第一条')).toBe('第一条');
  expect(reconcileOverlayDraft('', '', '语音识别草稿', null)).toBe('语音识别草稿');
});

it('restores failed submissions only when the next draft has not been edited', () => {
  const submitted = { text: '上一条', revision: 1 };
  expect(restoreOverlayDraft('', 1, submitted)).toBe('上一条');
  expect(restoreOverlayDraft('下一条', 2, submitted)).toBe('下一条');
  expect(restoreOverlayDraft('', 3, submitted)).toBe('');
});
it('keeps an empty ready editor through the delayed echo and completion of a sent message', () => {
  expect(reconcileOverlayDraft('', '', '已发送', '已发送')).toBe('');
  expect(reconcileOverlayDraft('', '已发送', '', '已发送')).toBe('');
});
