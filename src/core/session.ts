import type { Session, TranscriptEvent } from './types';

/** A final revision is immutable; late events cannot resurrect a stopped session. */
export function applyTranscript(state: Session, event: TranscriptEvent): Session {
  if (!state.id || state.id !== event.sessionId || !event.text.trim()) return state;
  const existing = state.segments.find((segment) => segment.id === event.segmentId);
  if (existing && (existing.final || event.revision <= existing.revision)) return state;
  const segment = {
    id: event.segmentId,
    revision: event.revision,
    source: event.text,
    final: event.final,
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
  };
  const segments = existing
    ? state.segments.map((item) => (item.id === segment.id ? segment : item))
    : [...state.segments, segment];
  return { ...state, segments: segments.slice(-500) };
}

export function applyTranslation(
  state: Session,
  sessionId: string,
  segmentId: string,
  revision: number,
  text: string,
): Session {
  if (!state.id || state.id !== sessionId) return state;
  return {
    ...state,
    segments: state.segments.map((segment) =>
      segment.id === segmentId && segment.revision === revision && segment.final
        ? { ...segment, translation: text }
        : segment,
    ),
  };
}
