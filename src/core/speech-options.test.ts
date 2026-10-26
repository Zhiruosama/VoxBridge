import { describe, expect, it } from 'vitest';
import { parseSpeechOptions, speechOptionDefaults, emotionOptions } from './speech-options';
import { defaults, parseSettings, profileFor } from './settings';
import { applyProviderPreset } from './provider-presets';
import { updateSpeechProfile } from './speech-presets';

describe('voice expression settings', () => {
  it('round-trips voice controls independently per service and does not change previous snapshots', () => {
    const original = applyProviderPreset(structuredClone(defaults), 'provider-minimax-cn');
    const options = {
      ...speechOptionDefaults,
      emotion: 'calm' as const,
      volume: 1.2,
      pitch: -2,
      intensity: 25,
      pronunciation: [' VoxBridge/vox bridge ', ''],
    };
    const next = updateSpeechProfile(original, { speechOptions: options });
    const restored = parseSettings(JSON.parse(JSON.stringify(next)));
    expect(profileFor(restored, 'tts').speechOptions).toMatchObject({
      emotion: 'calm',
      volume: 1.2,
      pitch: -2,
      intensity: 25,
      pronunciation: ['VoxBridge/vox bridge'],
    });
    expect(profileFor(original, 'tts').speechOptions).toBeUndefined();
    expect(profileFor(original, 'asr')).toEqual(profileFor(restored, 'asr'));
    expect(
      profileFor(applyProviderPreset(next, 'provider-openai-tts'), 'tts').speechOptions,
    ).toBeUndefined();
  });
  it('offers only supported emotions and resets incompatible emotions on model change', () => {
    expect(emotionOptions('speech-2.8-hd').map((p) => p.value)).toEqual([
      'auto',
      'calm',
      'happy',
      'sad',
      'angry',
      'fearful',
      'disgusted',
      'surprised',
    ]);
    expect(emotionOptions('speech-2.6-hd').some((p) => p.value === 'whisper')).toBe(true);
    expect(emotionOptions('custom-model').map((p) => p.value)).toEqual(['auto']);
    let settings = applyProviderPreset(structuredClone(defaults), 'provider-minimax-cn');
    settings = updateSpeechProfile(settings, {
      modelId: 'speech-2.6-hd',
      speechOptions: { ...speechOptionDefaults, emotion: 'whisper' },
    });
    settings = updateSpeechProfile(settings, { modelId: 'speech-2.8-hd' });
    expect(profileFor(settings, 'tts').speechOptions?.emotion).toBe('auto');
  });
  it('keeps safe defaults and rejects invalid parameters rather than sending paid requests', () => {
    expect(parseSpeechOptions({})).toEqual(speechOptionDefaults);
    for (const value of [
      { volume: 0 },
      { volume: Infinity },
      { pitch: 2.5 },
      { timbre: 101 },
      { emotion: 'toString' },
      { pronunciation: ['missing slash'] },
      { pronunciation: Array(51).fill('a/b') },
    ])
      expect(() => parseSpeechOptions(value)).toThrow();
    expect(parseSpeechOptions({ secret: 'discard-me' })).not.toHaveProperty('secret');
  });
});
