import { describe, expect, it } from 'vitest';
import { ListeningEpoch } from './listening';
import { applyTranscript, applyTranslation, discardUnfinished } from './session';
import type { ListeningEvent, Session } from './types';

describe('listening recovery', () => {
  it('rejects late captions, translations, status and duplicate recovery from the previous attempt', () => {
    const epochs = new ListeningEpoch();
    const caption: ListeningEvent = {
      type: 'transcript',
      sessionId: 's',
      segmentId: 's-1',
      revision: 1,
      text: 'old',
      final: false,
      startMs: 0,
      generation: 0,
    };
    expect(epochs.accept(caption)).toBe(true);
    const recovering: ListeningEvent = {
      type: 'recovering',
      sessionId: 's',
      attempt: 1,
      delayMs: 1000,
      reason: 'offline',
    };
    expect(epochs.accept(recovering)).toBe(true);
    expect(epochs.accept(recovering)).toBe(false);
    expect(epochs.accept(caption)).toBe(false);
    expect(
      epochs.accept({
        type: 'translation',
        sessionId: 's',
        generation: 0,
        segmentId: 's-1',
        revision: 1,
        text: 'late',
      }),
    ).toBe(false);
    expect(
      epochs.accept({
        type: 'progress',
        sessionId: 's',
        generation: 0,
        phase: 'running',
        sampleRate: 16000,
        frames: 100,
        rms: 0,
        droppedFrames: 0,
        droppedSegments: 0,
        discontinuities: 0,
      }),
    ).toBe(false);
    expect(epochs.accept({ ...caption, generation: 1, segmentId: 's-r1-1' })).toBe(true);
  });
  it('preserves final captions while removing incomplete speech and allowing fresh provider sentence IDs', () => {
    let state: Session = { id: 's', segments: [] };
    state = applyTranscript(state, {
      sessionId: 's',
      segmentId: 's-1',
      revision: 2,
      text: 'final',
      final: true,
    });
    state = applyTranslation(state, 's', 's-1', 2, '定稿');
    state = applyTranscript(state, {
      sessionId: 's',
      segmentId: 's-2',
      revision: 1,
      text: 'partial',
      final: false,
    });
    state = discardUnfinished(state);
    expect(state.segments).toHaveLength(1);
    expect(state.segments[0].translation).toBe('定稿');
    state = applyTranscript(state, {
      sessionId: 's',
      segmentId: 's-r1-1',
      revision: 1,
      text: 'new',
      final: true,
    });
    expect(state.segments.map((segment) => segment.source)).toEqual(['final', 'new']);
  });
});
