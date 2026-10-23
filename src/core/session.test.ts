import { describe, expect, it } from 'vitest';
import { appendExpression, applyTranscript, applyTranslation, discardUnfinished } from './session';
import type { Session, TranscriptEvent } from './types';

const event: TranscriptEvent = {
  sessionId: 'a',
  segmentId: 'one',
  revision: 1,
  text: 'Hello',
  final: false,
};
describe('transcript session isolation', () => {
  it('replaces partials, accepts one final, and ignores duplicate or late partials', () => {
    let state: Session = { id: 'a', segments: [] };
    state = applyTranscript(state, event);
    state = applyTranscript(state, { ...event, revision: 2, text: 'Hello world', final: true });
    const finalized = state;
    state = applyTranscript(state, { ...event, revision: 2, final: true });
    state = applyTranscript(state, { ...event, revision: 3 });
    expect(state).toBe(finalized);
    expect(state.segments).toHaveLength(1);
    expect(state.segments[0].source).toBe('Hello world');
  });
  it('rejects older revisions, stale translations and stopped session events', () => {
    const state = applyTranscript(
      { id: 'a', segments: [] },
      { ...event, revision: 2, final: true },
    );
    expect(applyTranscript(state, event)).toBe(state);
    expect(applyTranslation(state, 'a', 'one', 1, '错误').segments[0].translation).toBeUndefined();
    expect(applyTranslation(state, 'b', 'one', 2, '错误')).toBe(state);
    expect(applyTranscript({ ...state, id: null }, event).segments).toHaveLength(1);
    expect(applyTranslation(state, 'a', 'one', 2, '你好').segments[0].translation).toBe('你好');
  });
  it('pairs HTTP final segments with translations and isolates a restarted session', () => {
    let state = applyTranscript(
      { id: 'listen-1', segments: [] },
      {
        sessionId: 'listen-1',
        segmentId: 'listen-1-1',
        revision: 1,
        final: true,
        text: 'Good morning',
        startMs: 65000,
      },
    );
    state = applyTranslation(state, 'listen-1', 'listen-1-1', 1, '早上好');
    expect(state.segments[0]).toMatchObject({
      source: 'Good morning',
      translation: '早上好',
      final: true,
      time: '00:01:05',
    });
    const stopped = { ...state, id: null };
    expect(applyTranslation(stopped, 'listen-1', 'listen-1-1', 1, 'late')).toBe(stopped);
    const restarted: Session = { id: 'listen-2', segments: [] };
    expect(applyTranscript(restarted, { ...event, sessionId: 'listen-1', final: true })).toBe(
      restarted,
    );
  });
  it('bounds history without losing the newest segment', () => {
    let state: Session = { id: 'a', segments: [] };
    for (let i = 0; i < 501; i++)
      state = applyTranscript(state, { ...event, segmentId: String(i), final: true });
    expect(state.segments).toHaveLength(500);
    expect(state.segments.at(-1)?.id).toBe('500');
  });
});

describe('expression subtitles', () => {
  const expression = { id: 'one', source: '你好', translation: 'Hello', time: '12:30:00' };
  it('keeps a bilingual snapshot alongside live audio and survives audio recovery', () => {
    let state = applyTranscript({ id: 'a', segments: [] }, { ...event, final: true });
    state = appendExpression(state, expression);
    state = applyTranslation(state, 'a', 'one', 1, '音频译文');
    state = applyTranscript(state, { ...event, segmentId: 'partial' });
    state = discardUnfinished(state);
    expect(state.id).toBe('a');
    expect(state.segments).toHaveLength(2);
    expect(state.segments[0].translation).toBe('音频译文');
    expect(state.segments[1]).toMatchObject({ ...expression, id: 'expression:one', final: true });
    expect(expression.id).toBe('one');
  });
  it('displays completed expressions without listening and bounds the shared feed', () => {
    let state: Session = { id: null, segments: [] };
    for (let i = 0; i < 501; i++) state = appendExpression(state, { ...expression, id: String(i) });
    expect(state.id).toBeNull();
    expect(state.segments).toHaveLength(500);
    expect(state.segments.at(-1)?.id).toBe('expression:500');
    state = appendExpression(state, { ...expression, id: '500', translation: 'Updated' });
    expect(state.segments).toHaveLength(500);
    expect(state.segments.at(-1)?.translation).toBe('Updated');
  });
});

describe('interim translation revisions', () => {
  it('shows a translated prefix during continuous speech and replaces it with the final result', () => {
    let state = applyTranscript({ id: 'a', segments: [] }, { ...event, text: 'Hello world' });
    state = applyTranscript(state, { ...event, revision: 2, text: 'Hello world again' });
    state = applyTranslation(state, 'a', 'one', 1, '你好世界', 'Hello world');
    expect(state.segments[0].translation).toBe('你好世界');
    state = applyTranscript(state, {
      ...event,
      revision: 3,
      text: 'Hello world again',
      final: true,
    });
    expect(state.segments[0].translation).toBe('你好世界');
    state = applyTranslation(state, 'a', 'one', 2, '晚到的临时译文', 'Hello world again');
    expect(state.segments[0].translation).toBe('你好世界');
    state = applyTranslation(state, 'a', 'one', 3, '世界你好，又见面了');
    expect(state.segments[0].translation).toBe('世界你好，又见面了');
  });
  it('rejects changed ASR text, older previews, and other sessions', () => {
    let state = applyTranscript({ id: 'a', segments: [] }, { ...event, text: 'I can go' });
    state = applyTranslation(state, 'a', 'one', 1, '我能去', 'I can go');
    state = applyTranscript(state, { ...event, revision: 2, text: 'I cannot go' });
    expect(state.segments[0].translation).toBeUndefined();
    expect(
      applyTranslation(state, 'a', 'one', 1, '错误', 'I can go').segments[0].translation,
    ).toBeUndefined();
    state = applyTranslation(state, 'a', 'one', 2, '我不能去', 'I cannot go');
    expect(
      applyTranslation(state, 'a', 'one', 1, '旧结果', 'I cannot').segments[0].translation,
    ).toBe('我不能去');
    expect(applyTranslation(state, 'b', 'one', 2, '其他会话', 'I cannot go')).toBe(state);
  });
});

describe('committed realtime caption chunks', () => {
  it('retains completed translations across tail rewrites, clearing and recovery', () => {
    let state = applyTranscript({ id: 'a', segments: [] }, { ...event, final: true });
    state = applyTranslation(state, 'a', 'one', 1, '已经翻译好的短句');
    state = applyTranscript(state, { ...event, segmentId: 'tail', text: 'Unfinished tail' });
    state = applyTranscript(state, {
      ...event,
      segmentId: 'tail',
      revision: 2,
      text: 'Corrected tail',
    });
    state = applyTranscript(state, {
      ...event,
      segmentId: 'tail',
      revision: 3,
      text: '',
      final: true,
    });
    state = discardUnfinished(state);
    expect(state.segments).toHaveLength(1);
    expect(state.segments[0].translation).toBe('已经翻译好的短句');
    expect(
      applyTranscript(state, {
        ...event,
        revision: 9,
        text: 'A whole revised paragraph',
        final: true,
      }),
    ).toBe(state);
  });
  it('keeps source order when short translations complete out of order', () => {
    let state: Session = { id: 'a', segments: [] };
    for (const id of ['first', 'second', 'third'])
      state = applyTranscript(state, { ...event, segmentId: id, text: id, final: true });
    for (const id of ['second', 'third', 'first'])
      state = applyTranslation(state, 'a', id, 1, `${id} translated`);
    expect(state.segments.map((s) => s.id)).toEqual(['first', 'second', 'third']);
    expect(state.segments.every((s) => s.translation?.endsWith(' translated'))).toBe(true);
  });
});
