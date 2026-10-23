import { describe, expect, it } from 'vitest';
import {
  newerOverlay,
  overlaySnapshot,
  parseSubtitleAppearance,
  subtitleDefaults,
} from './overlay';
import type { Session } from './types';

describe('subtitle overlay', () => {
  it('migrates missing preferences, clamps values and strips extra fields', () => {
    expect(parseSubtitleAppearance(undefined)).toEqual(subtitleDefaults);
    expect(parseSubtitleAppearance({ fontSize: NaN, backgroundOpacity: Infinity })).toEqual(
      subtitleDefaults,
    );
    expect(
      parseSubtitleAppearance({ fontSize: 80, backgroundOpacity: -1, text: 'never-save' }),
    ).toEqual({ fontSize: 40, backgroundOpacity: 0.2 });
  });
  it('publishes only recent text without profiles, credentials or audio', () => {
    const session: Session = {
      id: 'active',
      segments: Array.from({ length: 5 }, (_, i) => ({
        id: String(i),
        revision: 1,
        final: true,
        source: `line ${i}`,
        translation: `译文 ${i}`,
        time: '00:00:00',
      })),
    };
    const snapshot = overlaySnapshot(session, 'running', subtitleDefaults, 3);
    expect(snapshot.lines).toHaveLength(3);
    expect(snapshot.lines[0].source).toBe('line 2');
    expect(Object.keys(snapshot).sort()).toEqual([
      'backgroundOpacity',
      'fontSize',
      'lines',
      'phase',
      'sessionId',
      'version',
    ]);
  });
  it('clips oversized Unicode text so stopping remains publishable', () => {
    const session: Session = {
      id: null,
      segments: [
        {
          id: 'one',
          revision: 1,
          final: true,
          source: '你'.repeat(7000),
          translation: '😀'.repeat(7000),
          time: '00:00:00',
        },
      ],
    };
    const snapshot = overlaySnapshot(session, 'idle', subtitleDefaults, 2);
    expect(Array.from(snapshot.lines[0].source)).toHaveLength(6000);
    expect(Array.from(snapshot.lines[0].translation!)).toHaveLength(6000);
    expect(snapshot.phase).toBe('idle');
  });
  it('initial snapshot fetch cannot overwrite a newer event or restore stopped session', () => {
    const older = overlaySnapshot({ id: 'old', segments: [] }, 'running', subtitleDefaults, 1);
    const stopped = overlaySnapshot({ id: null, segments: [] }, 'idle', subtitleDefaults, 2);
    expect(newerOverlay(stopped, older)).toBe(stopped);
    expect(newerOverlay(older, stopped)).toBe(stopped);
    expect(newerOverlay(stopped, stopped)).toBe(stopped);
  });
});
