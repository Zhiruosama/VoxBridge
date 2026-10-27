import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { setUiLanguage } from '../i18n';
import BilingualToggle from './BilingualToggle';

describe('bilingual caption control', () => {
  it('exposes its state and action in both interface languages without native hover tooltips', () => {
    try {
      for (const language of ['zh-CN', 'en'] as const) {
        setUiLanguage(language);
        for (const checked of [true, false]) {
          const html = renderToStaticMarkup(
            <BilingualToggle checked={checked} onChange={() => {}} />,
          );
          expect(html).toContain('role="switch"');
          expect(html).toContain(`aria-checked="${checked}"`);
          expect(html).toContain(language === 'en' ? 'Bilingual captions' : '双语字幕');
          expect(html).not.toContain(' title=');
        }
      }
    } finally {
      setUiLanguage('zh-CN');
    }
  });
});
