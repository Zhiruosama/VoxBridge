import type { OverlaySnapshot, Session, SubtitleAppearance } from './types';

export const subtitleDefaults: SubtitleAppearance = { fontSize: 22, backgroundOpacity: 0.82 };

export function parseSubtitleAppearance(value: unknown): SubtitleAppearance {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    fontSize:
      typeof input.fontSize === 'number' && Number.isFinite(input.fontSize)
        ? Math.round(Math.max(14, Math.min(40, input.fontSize)))
        : subtitleDefaults.fontSize,
    backgroundOpacity:
      typeof input.backgroundOpacity === 'number' && Number.isFinite(input.backgroundOpacity)
        ? Math.max(0.2, Math.min(1, input.backgroundOpacity))
        : subtitleDefaults.backgroundOpacity,
  };
}

export function overlaySnapshot(
  session: Session,
  phase: OverlaySnapshot['phase'],
  appearance: SubtitleAppearance,
  version: number,
): OverlaySnapshot {
  return {
    version,
    sessionId: session.id,
    phase,
    ...parseSubtitleAppearance(appearance),
    lines: session.segments.slice(-3).map((segment) => ({
      source: Array.from(segment.source).slice(0, 6000).join(''),
      translation:
        segment.translation === undefined
          ? undefined
          : Array.from(segment.translation).slice(0, 6000).join(''),
      time: segment.time.slice(0, 32),
    })),
  };
}

export function newerOverlay(current: OverlaySnapshot, next: OverlaySnapshot): OverlaySnapshot {
  return next.version > current.version ? next : current;
}
