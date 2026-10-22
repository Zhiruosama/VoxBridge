import { describe, expect, it } from 'vitest';
import { defaults, parseSettings, profileFor } from './settings';
import { applyProviderPreset } from './provider-presets';

describe('provider presets', () => {
  it('adds separate provider profiles and preserves user changes on reuse', () => {
    const input = structuredClone(defaults);
    const deepseek = applyProviderPreset(input, 'provider-deepseek-flash');
    expect(input.profiles).toHaveLength(3);
    expect(profileFor(deepseek, 'translation')).toMatchObject({
      modelId: 'deepseek-flash',
      thinking: 'disabled',
    });
    profileFor(deepseek, 'translation').modelId = 'custom-model';
    const again = applyProviderPreset(deepseek, 'provider-deepseek-flash');
    expect(again.profiles).toHaveLength(4);
    expect(profileFor(again, 'translation').modelId).toBe('custom-model');
    const minimax = applyProviderPreset(again, 'provider-minimax-cn');
    expect(profileFor(minimax, 'tts')).toMatchObject({
      modelId: 'speech-2.8-turbo',
      baseUrl: 'wss://api.minimax.cn/ws/v1/t2a_v2',
    });
    expect(profileFor(parseSettings(minimax), 'translation').thinking).toBe('disabled');
  });
  it('does not import arbitrary thinking options or leak fields across stages', () => {
    const input = structuredClone(defaults);
    Object.assign(input.profiles[1], { thinking: 'unsafe', apiKey: 'never-save' });
    Object.assign(input.profiles[2], { thinking: 'enabled' });
    const output = parseSettings(input);
    expect(output.profiles[1].thinking).toBeUndefined();
    expect(output.profiles[2].thinking).toBeUndefined();
    expect(JSON.stringify(output)).not.toContain('never-save');
  });
});
