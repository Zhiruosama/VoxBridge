import { describe, expect, it } from 'vitest';
import { textPanelOpacity, textSplitRatio } from './text-translation-layout';
import { defaults, parseSettings } from './settings';

describe('text translation appearance persistence', () => {
  it('migrates old settings to a slightly translucent background', () => {
    expect(
      parseSettings({ ...defaults, textTranslationOpacity: undefined }).textTranslationOpacity,
    ).toBe(85);
  });
  it('keeps valid opacity across settings serialization and bounds invalid values', () => {
    expect(
      parseSettings(JSON.parse(JSON.stringify({ ...defaults, textTranslationOpacity: 45 })))
        .textTranslationOpacity,
    ).toBe(45);
    expect(textPanelOpacity(-20)).toBe(0);
    expect(textPanelOpacity(120)).toBe(100);
    for (const value of [null, '80', NaN, Infinity]) expect(textPanelOpacity(value)).toBe(85);
  });
  it('keeps both panels usable and falls back safely for damaged saved widths', () => {
    expect(textSplitRatio(61.5)).toBe(62);
    expect(textSplitRatio(-10)).toBe(30);
    expect(textSplitRatio(100)).toBe(70);
    for (const value of [null, '60', NaN, Infinity, {}]) expect(textSplitRatio(value)).toBe(50);
  });
});
