import type { CSSProperties } from 'react';
import { t } from '../i18n';
import {
  captionGroups,
  captionSeparator,
  type CaptionLayout,
  type CaptionMember,
} from '../core/caption-layout';
import ExpressionReveal from './ExpressionReveal';

/** One display projection for the main window and floating captions. No service calls. */
export default function CaptionFeed({
  lines,
  layout,
  scope,
  content = 'bilingual',
}: {
  lines: readonly CaptionMember[];
  layout: CaptionLayout;
  scope: 'workspace' | 'overlay';
  content?: 'source' | 'translation' | 'bilingual';
}) {
  return (
    <>
      {captionGroups(lines, layout).map((group) => {
        const first = group.members[0];
        const expression = first.segmentId.startsWith('expression:');
        const color = first.color ?? '#ffffff';
        const main = scope === 'workspace';
        const reveal = (value: string) =>
          main && expression ? <ExpressionReveal text={value} /> : value;
        const hasSource = (line: CaptionMember) =>
          content !== 'translation' && (!main || line.source.trim() !== line.translation?.trim());
        function row(kind: 'source' | 'translation') {
          let previous = '';
          return group.members.map((line) => {
            if (kind === 'source' && !hasSource(line)) return null;
            const value = kind === 'source' ? line.source : (line.translation ?? '');
            const pending =
              kind === 'translation' &&
              !line.translation &&
              (line.final || content === 'translation');
            if (!value && !pending) return null;
            const separator = captionSeparator(previous, value);
            if (value) previous = value;
            return (
              <span
                key={line.segmentId}
                data-caption-id={kind === 'source' || !hasSource(line) ? line.segmentId : undefined}
                className={
                  !line.translation && kind === 'translation' ? 'caption-untranslated' : undefined
                }
              >
                {separator}
                {reveal(value)}
                {pending && (
                  <span className="caption-inline-status" role="status">
                    {t(
                      !line.final
                        ? '识别中…'
                        : line.translationState === 'failed'
                          ? '暂未译出'
                          : '翻译中…',
                    )}
                  </span>
                )}
              </span>
            );
          });
        }
        return (
          <article
            key={group.id}
            className={`${main ? 'segment' : 'overlay-caption'} caption-group is-${layout}`}
            style={
              {
                color: main ? undefined : color,
                '--caption-color': color === '#ffffff' ? 'var(--text)' : color,
                '--caption-source':
                  color === '#ffffff'
                    ? 'var(--muted)'
                    : `color-mix(in srgb, ${color} 72%, var(--bg))`,
                '--overlay-source-color': `color-mix(in srgb, ${color} 72%, #16181d)`,
              } as CSSProperties
            }
          >
            {main && (
              <div className="segment-meta">
                <time>{first.time}</time>
                {!first.final && <span>{t('识别中…')}</span>}
              </div>
            )}
            {content !== 'translation' && group.members.some(hasSource) && (
              <p
                dir="auto"
                className={
                  main
                    ? 'source-text'
                    : content === 'source'
                      ? 'subtitle-overlay-translation'
                      : 'subtitle-overlay-source'
                }
              >
                {row('source')}
              </p>
            )}
            {content !== 'source' && (
              <p dir="auto" className={main ? 'translation-text' : 'subtitle-overlay-translation'}>
                {row('translation')}
              </p>
            )}
          </article>
        );
      })}
    </>
  );
}
