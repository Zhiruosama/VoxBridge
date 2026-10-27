import { captionColorDefaults, parseCaptionColors } from './caption-colors';
import type { OverlaySnapshot, Session, SubtitleAppearance } from './types';

export const subtitleColors = ['#ffffff', '#ffe082', '#a5d6a7', '#80deea', '#ffcc80', '#f8bbd0'];
export const subtitleDefaults: SubtitleAppearance = {
  fontSize: 22,
  backgroundOpacity: 0.82,
  mode: 'continuous',
  content: 'translation',
  colorMode: 'workspace',
  textColor: '#ffffff',
  lineHeight: 1.65,
};
export const overlayHistoryLimit = 160;
export const overlayCharacterBudget = 48000;

export function parseSubtitleAppearance(value: unknown): SubtitleAppearance {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    mode: input.mode === 'compact' ? 'compact' : subtitleDefaults.mode,
    content:
      input.content === 'bilingual' || input.content === 'source'
        ? input.content
        : subtitleDefaults.content,
    colorMode: input.colorMode === 'custom' ? 'custom' : 'workspace',
    textColor:
      typeof input.textColor === 'string' && /^#[\da-f]{6}$/i.test(input.textColor)
        ? input.textColor.toLowerCase()
        : subtitleDefaults.textColor,
    lineHeight:
      typeof input.lineHeight === 'number' && Number.isFinite(input.lineHeight)
        ? Math.max(1.2, Math.min(2.2, input.lineHeight))
        : subtitleDefaults.lineHeight,
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
  captionColors = captionColorDefaults,
  uiLanguage: 'zh-CN' | 'en' = 'zh-CN',
  captionLayout: import('./caption-layout').CaptionLayout = 'sentence',
): OverlaySnapshot {
  const parsed = parseSubtitleAppearance(appearance);
  const colors = parseCaptionColors(captionColors);
  // Always send a complete bounded snapshot: dropped events and reopening need no delta replay.
  const lines: OverlaySnapshot['lines'] = [];
  let budget = overlayCharacterBudget;
  for (const segment of session.segments
    .slice(parsed.mode === 'compact' ? -3 : -overlayHistoryLimit)
    .reverse()) {
    const source = Array.from(segment.source).slice(0, 6000).join('');
    const translation =
      segment.translation === undefined
        ? undefined
        : Array.from(segment.translation).slice(0, 6000).join('');
    const cost = Array.from(source).length + Array.from(translation ?? '').length;
    if (cost > budget) break;
    budget -= cost;
    lines.unshift({
      segmentId: segment.id,
      paragraphId: segment.paragraphId,
      color:
        parsed.colorMode === 'workspace'
          ? colors[segment.id.startsWith('expression:') ? 'expression' : 'recognition']
          : parsed.textColor,
      revision: segment.revision,
      final: segment.final,
      translationState: translation ? 'ready' : segment.translationError ? 'failed' : 'pending',
      source,
      translation,
      time: segment.time.slice(0, 32),
    });
  }
  return { uiLanguage, version, sessionId: session.id, phase, ...parsed, captionLayout, lines };
}

export function newerOverlay(current: OverlaySnapshot, next: OverlaySnapshot): OverlaySnapshot {
  return next.version > current.version ? next : current;
}
