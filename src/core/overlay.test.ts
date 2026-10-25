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
    ).toEqual({ ...subtitleDefaults, fontSize: 40, backgroundOpacity: 0.2 });
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
    const snapshot = overlaySnapshot(
      session,
      'running',
      { ...subtitleDefaults, mode: 'compact' },
      3,
    );
    expect(snapshot.lines).toHaveLength(3);
    expect(snapshot.lines[0].source).toBe('line 2');
    expect(Object.keys(snapshot).sort()).toEqual([
      'backgroundOpacity',
      'colorMode',
      'content',
      'fontSize',
      'lineHeight',
      'lines',
      'mode',
      'phase',
      'sessionId',
      'textColor',
      'uiLanguage',
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
  it('bounds continuous history by both captions and Unicode character cost', () => {
    const session: Session = {
      id: 'history',
      segments: Array.from({ length: 500 }, (_, i) => ({
        id: String(i),
        revision: 2,
        final: true,
        source: '你'.repeat(400),
        translation: '😀'.repeat(400),
        time: '00:00:00',
      })),
    };
    const snapshot = overlaySnapshot(session, 'running', subtitleDefaults, 1);
    expect(snapshot.lines).toHaveLength(60);
    expect(snapshot.lines[0].segmentId).toBe('440');
    expect(snapshot.lines.at(-1)?.segmentId).toBe('499');
    session.segments.forEach((s) => {
      s.source = 'a';
      s.translation = 'b';
    });
    expect(overlaySnapshot(session, 'running', subtitleDefaults, 2).lines).toHaveLength(160);
  });
  it('keeps IDs and pending slots ordered while translation arrives out of order', () => {
    const session: Session = {
      id: 'session',
      segments: [
        { id: 'first', revision: 3, final: true, source: 'one', time: '00:00:00' },
        {
          id: 'second',
          revision: 1,
          final: true,
          source: 'two',
          translation: '二',
          time: '00:00:01',
        },
        { id: 'tail', revision: 2, final: false, source: 'three', time: '00:00:02' },
      ],
    };
    let snapshot = overlaySnapshot(session, 'running', subtitleDefaults, 1);
    expect(snapshot.lines.map((s) => [s.segmentId, s.translationState])).toEqual([
      ['first', 'pending'],
      ['second', 'ready'],
      ['tail', 'pending'],
    ]);
    session.segments[0].translationError = true;
    snapshot = overlaySnapshot(session, 'running', subtitleDefaults, 2);
    expect(snapshot.lines[0].translationState).toBe('failed');
    session.segments[0].translation = '一';
    snapshot = overlaySnapshot(session, 'running', subtitleDefaults, 3);
    expect(snapshot.lines.map((s) => s.segmentId)).toEqual(['first', 'second', 'tail']);
    expect(snapshot.lines[0]).toMatchObject({
      revision: 3,
      final: true,
      translationState: 'ready',
    });
  });
  it('validates display preferences and strips unsupported colors', () => {
    expect(
      parseSubtitleAppearance({
        mode: 'invalid',
        content: 'invalid',
        textColor: 'url(secret)',
        lineHeight: Infinity,
      }),
    ).toEqual(subtitleDefaults);
    expect(
      parseSubtitleAppearance({
        mode: 'compact',
        content: 'bilingual',
        textColor: '#80deea',
        lineHeight: 5,
      }),
    ).toMatchObject({
      mode: 'compact',
      content: 'bilingual',
      textColor: '#80deea',
      lineHeight: 2.2,
    });
  });
});

it('follows workspace colors separately for recognition and expression captions', () => {
  const session: Session = {
    id: null,
    segments: [
      { id: 'heard', revision: 1, final: true, source: 'hello', time: '00:00:00' },
      { id: 'expression:spoken', revision: 1, final: true, source: '你好', time: '00:00:01' },
    ],
  };
  const colors = { recognition: '#80deea', expression: '#ffcc80' };
  expect(
    overlaySnapshot(session, 'idle', subtitleDefaults, 1, colors).lines.map((line) => line.color),
  ).toEqual(['#80deea', '#ffcc80']);
  expect(
    overlaySnapshot(
      session,
      'idle',
      { ...subtitleDefaults, colorMode: 'custom', textColor: '#12ab34' },
      2,
      colors,
    ).lines.map((line) => line.color),
  ).toEqual(['#12ab34', '#12ab34']);
});
it('keeps a custom color available when migrating to workspace sync', () => {
  expect(parseSubtitleAppearance({ textColor: '#12AB34' })).toMatchObject({
    colorMode: 'workspace',
    textColor: '#12ab34',
  });
  expect(parseSubtitleAppearance({ colorMode: 'custom', textColor: 'url(secret)' })).toMatchObject({
    colorMode: 'custom',
    textColor: '#ffffff',
  });
});
