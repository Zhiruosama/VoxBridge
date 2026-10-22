import { describe, expect, it } from 'vitest';
import { applyTranscript, applyTranslation } from './session';
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
  it('bounds history without losing the newest segment', () => {
    let state: Session = { id: 'a', segments: [] };
    for (let i = 0; i < 501; i++)
      state = applyTranscript(state, { ...event, segmentId: String(i), final: true });
    expect(state.segments).toHaveLength(500);
    expect(state.segments.at(-1)?.id).toBe('500');
  });
});
