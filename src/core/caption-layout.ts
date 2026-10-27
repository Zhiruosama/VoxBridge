import type { Segment } from './types';

export type CaptionLayout = 'sentence' | 'paragraph';
export type ParagraphIdentity = Pick<
  Segment,
  'paragraphId' | 'paragraphSize' | 'paragraphCharacters' | 'recognitionGroup'
>;

/** Assign identity only when source text is committed, never when a translation arrives.
 * Counts travel with the last member so trimming the first member cannot regroup history. */
export function assignParagraph(
  previous: Segment | undefined,
  id: string,
  source: string,
  group: string,
): ParagraphIdentity {
  const characters = Array.from(source).length;
  const limit = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(source) ? 120 : 360;
  const join =
    previous?.final &&
    previous.recognitionGroup === group &&
    previous.paragraphId &&
    (previous.paragraphSize ?? 1) < 3 &&
    (previous.paragraphCharacters ?? 0) + characters <= limit;
  return {
    recognitionGroup: group,
    paragraphId: join ? previous.paragraphId : id,
    paragraphSize: join ? (previous.paragraphSize ?? 1) + 1 : 1,
    paragraphCharacters: join ? (previous.paragraphCharacters ?? 0) + characters : characters,
  };
}

export interface CaptionMember {
  segmentId: string;
  paragraphId?: string;
  color?: string;
  final: boolean;
  source: string;
  translation?: string;
  translationState: 'pending' | 'ready' | 'failed';
  time: string;
}

/** Display projection only: keep member objects, ordering, revisions and pending slots intact. */
export function captionGroups<T extends CaptionMember>(lines: readonly T[], layout: CaptionLayout) {
  const groups: { id: string; members: T[] }[] = [];
  for (const line of lines) {
    const previous = groups.at(-1);
    const id =
      layout === 'paragraph' && line.final ? (line.paragraphId ?? line.segmentId) : line.segmentId;
    if (
      layout === 'paragraph' &&
      line.final &&
      !line.segmentId.startsWith('expression:') &&
      previous?.id === id &&
      previous.members.every(
        (member) => member.final && !member.segmentId.startsWith('expression:'),
      )
    )
      previous.members.push(line);
    else groups.push({ id, members: [line] });
  }
  return groups;
}

/** Join written text without inserting spaces into Chinese, Japanese or Thai. */
export function captionSeparator(previous: string, next: string): string {
  if (!previous || !next || /\s$/u.test(previous) || /^\s/u.test(next)) return '';
  if (/^[,.;:!?，。！？、；：)\]}”’]/u.test(next) || /[(\[{“‘]$/u.test(previous)) return '';
  const unspaced =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}]/u;
  if (unspaced.test(Array.from(previous).at(-1)!) || unspaced.test(Array.from(next)[0])) return '';
  return ' ';
}

export function workspaceCaptions(
  segments: readonly Segment[],
  colors: { expression: string; recognition: string },
): CaptionMember[] {
  return segments.map((segment) => ({
    segmentId: segment.id,
    paragraphId: segment.paragraphId,
    final: segment.final,
    color: colors[segment.id.startsWith('expression:') ? 'expression' : 'recognition'],
    source: segment.source,
    translation: segment.translation,
    time: segment.time,
    translationState: segment.translation
      ? 'ready'
      : segment.translationError
        ? 'failed'
        : 'pending',
  }));
}
