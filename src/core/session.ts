import { assignParagraph } from './caption-layout';
import type { Session, TranscriptEvent } from './types';

/** A final revision is immutable; late events cannot resurrect a stopped session. */
export function applyTranscript(state: Session, event: TranscriptEvent): Session {
  if (!state.id || state.id !== event.sessionId) return state;
  const existing = state.segments.find((segment) => segment.id === event.segmentId);
  if (existing && (existing.final || event.revision <= existing.revision)) return state;
  if (!event.text.trim()) {
    return existing && event.final
      ? { ...state, segments: state.segments.filter((segment) => segment.id !== event.segmentId) }
      : state;
  }
  const index = existing ? state.segments.indexOf(existing) : state.segments.length;
  const paragraph = event.final
    ? assignParagraph(
        state.segments[index - 1],
        event.segmentId,
        event.text,
        `${event.sessionId}:${event.generation ?? 0}`,
      )
    : {};
  const segment = {
    ...paragraph,
    id: event.segmentId,
    revision: event.revision,
    source: event.text,
    final: event.final,
    ...(existing && event.text.startsWith(existing.source)
      ? { translation: existing.translation, translationRevision: existing.translationRevision }
      : {}),
    time:
      event.startMs !== undefined && Number.isFinite(event.startMs) && event.startMs >= 0
        ? [
            Math.floor(event.startMs / 3600000),
            Math.floor(event.startMs / 60000) % 60,
            Math.floor(event.startMs / 1000) % 60,
          ]
            .map((part) => String(part).padStart(2, '0'))
            .join(':')
        : new Date().toLocaleTimeString('zh-CN', { hour12: false }),
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
  sourceText?: string,
): Session {
  if (!state.id || state.id !== sessionId) return state;
  return {
    ...state,
    segments: state.segments.map((segment) => {
      if (segment.id !== segmentId || revision < (segment.translationRevision ?? 0)) return segment;
      const matches =
        sourceText === undefined
          ? segment.final && segment.revision === revision
          : !segment.final &&
            revision <= segment.revision &&
            !!sourceText.trim() &&
            segment.source.startsWith(sourceText);
      return matches
        ? { ...segment, translation: text, translationRevision: revision, translationError: false }
        : segment;
    }),
  };
}

/** Preserve final subtitles across reconnects; unfinished text belongs to the old audio stream. */
export function discardUnfinished(state: Session): Session {
  return { ...state, segments: state.segments.filter((segment) => segment.final) };
}

/** Expression results share the subtitle feed without changing the active audio session. */
export function appendExpression(
  state: Session,
  expression: { id: string; source: string; translation: string; time: string },
): Session {
  const segment = { ...expression, id: `expression:${expression.id}`, revision: 1, final: true };
  const segments = state.segments.filter((item) => item.id !== segment.id);
  return { ...state, segments: [...segments, segment].slice(-500) };
}

export function applyTranslationError(
  state: Session,
  sessionId: string,
  segmentId: string,
  revision: number,
): Session {
  if (state.id !== sessionId) return state;
  return {
    ...state,
    segments: state.segments.map((segment) =>
      segment.id === segmentId &&
      segment.final &&
      segment.revision === revision &&
      !segment.translation
        ? { ...segment, translationError: true }
        : segment,
    ),
  };
}

/** Closed sessions keep completed text, discard hypotheses and mark unfinished translations. */
export function endSession(state: Session): Session {
  return {
    id: null,
    segments: state.segments
      .filter((segment) => segment.final)
      .map((segment) => (segment.translation ? segment : { ...segment, translationError: true })),
  };
}
