import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import CaptionFeed from '../components/CaptionFeed';
import {
  assignParagraph,
  captionGroups,
  captionSeparator,
  workspaceCaptions,
} from './caption-layout';
import { appendExpression, applyTranscript, applyTranslation } from './session';
import { defaults, parseSettings } from './settings';
import { overlaySnapshot } from './overlay';
import type { Session } from './types';

function add(
  state: Session,
  id: string,
  source = 'A sentence.',
  generation = 0,
  final = true,
): Session {
  return applyTranscript(state, {
    sessionId: state.id!,
    segmentId: id,
    revision: 1,
    text: source,
    generation,
    final,
  });
}
function three() {
  let state: Session = { id: 'session', segments: [] };
  for (const id of ['a', 'b', 'c']) state = add(state, id);
  return state;
}
const lines = (state: Session) => workspaceCaptions(state.segments, defaults.captionColors);

describe('caption display projection', () => {
  it('groups at most three committed members and leaves the partial tail independent', () => {
    let state = three();
    state = add(state, 'partial', 'Still speaking', 0, false);
    expect(
      captionGroups(lines(state), 'paragraph').map((g) => g.members.map((m) => m.segmentId)),
    ).toEqual([['a', 'b', 'c'], ['partial']]);
    expect(captionGroups(lines(state), 'sentence')).toHaveLength(4);
    state = applyTranscript(state, {
      sessionId: 'session',
      segmentId: 'partial',
      revision: 2,
      text: 'Now complete.',
      final: true,
    });
    expect(state.segments.at(-1)?.paragraphId).toBe('partial');
  });

  it('keeps paragraph identities and pending slots when translations arrive out of order', () => {
    let state = three();
    const identities = state.segments.map((s) => s.paragraphId);
    state = applyTranslation(state, 'session', 'c', 1, 'Third.');
    state = applyTranslation(state, 'session', 'a', 1, 'First.');
    const group = captionGroups(lines(state), 'paragraph')[0];
    expect(group.members.map((m) => m.translation)).toEqual(['First.', undefined, 'Third.']);
    expect(group.members[1].translationState).toBe('pending');
    expect(state.segments.map((s) => s.paragraphId)).toEqual(identities);
    const before = structuredClone(state);
    captionGroups(lines(state), 'sentence');
    captionGroups(lines(state), 'paragraph');
    expect(state).toEqual(before);
  });

  it('does not cross recovery generations, sessions or expression messages', () => {
    let state = add(three(), 'new-generation', 'New audio.', 1);
    expect(state.segments.at(-1)?.paragraphId).toBe('new-generation');
    state = appendExpression(state, {
      id: 'mine',
      source: 'My message.',
      translation: '我的消息。',
      time: 'now',
    });
    state = add(state, 'after-expression', 'Back to listening.', 1);
    expect(state.segments.at(-1)?.paragraphId).toBe('after-expression');
    state = add({ ...state, id: 'another' }, 'new-session', 'Another source.', 1);
    expect(state.segments.at(-1)?.paragraphId).toBe('new-session');
  });

  it('bounds source character counts and retains group IDs after history clipping', () => {
    let state: Session = { id: 'session', segments: [] };
    for (let i = 0; i < 502; i++) state = add(state, String(i));
    expect(state.segments).toHaveLength(500);
    expect(state.segments[0].id).toBe('2');
    expect(state.segments[0].paragraphId).toBe('0');
    const projected = captionGroups(lines(state), 'paragraph');
    expect(projected[0].id).toBe('0');
    expect(projected[0].members.map((m) => m.segmentId)).toEqual(['2']);
    for (const text of ['你'.repeat(61), 'a'.repeat(181)]) {
      let bounded: Session = { id: 'budget', segments: [] };
      bounded = add(add(bounded, 'first', text), 'second', text);
      expect(bounded.segments[1].paragraphId).toBe('second');
    }
    expect(assignParagraph(undefined, 'unicode', '😀', 'g').paragraphCharacters).toBe(1);
  });

  it('uses the same member identities in main and bounded overlay projections', () => {
    const state = three();
    const snapshot = overlaySnapshot(
      state,
      'running',
      defaults.subtitle,
      1,
      defaults.captionColors,
      'en',
      'paragraph',
    );
    expect(snapshot.captionLayout).toBe('paragraph');
    expect(captionGroups(snapshot.lines, 'paragraph').map((g) => g.id)).toEqual(
      captionGroups(lines(state), 'paragraph').map((g) => g.id),
    );
    expect(snapshot.lines.map((l) => l.source)).toEqual(state.segments.map((s) => s.source));
    expect(parseSettings({ ...defaults, captionLayout: 'paragraph' }).captionLayout).toBe(
      'paragraph',
    );
    expect(parseSettings({ ...defaults, captionLayout: 'invalid' }).captionLayout).toBe('sentence');
  });

  it('joins CJK and Thai without spaces, but preserves word spaces, decimals and punctuation', () => {
    for (const [left, right, expected] of [
      ['你好。', '明天见。', ''],
      ['テスト。', '次です。', ''],
      ['สวัสดี', 'ครับ', ''],
      ['Hello.', 'Next sentence.', ' '],
      ['السعر', '٣٫١٤ دولار', ' '],
      ['안녕하세요.', '반갑습니다.', ' '],
      ['Dr.', 'Smith paid 3.14 dollars.', ' '],
      ['Ready', '?', ''],
      ['Hello ', 'world', ''],
    ])
      expect(captionSeparator(left, right)).toBe(expected);
  });

  it('renders each translated, pending and failed slot without losing original text or anchors', () => {
    let state = three();
    state = applyTranslation(state, 'session', 'a', 1, 'First result.');
    state = {
      ...state,
      segments: state.segments.map((s) => (s.id === 'c' ? { ...s, translationError: true } : s)),
    };
    const html = renderToStaticMarkup(
      createElement(CaptionFeed, { lines: lines(state), layout: 'paragraph', scope: 'workspace' }),
    );
    expect((html.match(/<article/g) ?? []).length).toBe(1);
    expect(html).toContain('First result.');
    expect(html).toContain('翻译中…');
    expect(html).toContain('暂未译出');
    for (const id of ['a', 'b', 'c']) expect(html).toContain(`data-caption-id="${id}"`);
    expect((html.match(/A sentence\./g) ?? []).length).toBe(3);
    expect(html).toContain('dir="auto"');
  });
});
