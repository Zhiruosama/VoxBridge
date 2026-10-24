import { describe, expect, it } from 'vitest';
import { defaults, profileFor, parseSettings } from './settings';
import { applyProviderPreset } from './provider-presets';
import { modelOptions, voiceOptions, updateSpeechProfile } from './speech-presets';

describe('provider-specific speech choices', () => {
  it('keeps custom/cloned voices and separates vendors and model voice support', () => {
    const settings = applyProviderPreset(structuredClone(defaults), 'provider-minimax-cn');
    const minimax = profileFor(settings, 'tts');
    expect(voiceOptions({ ...minimax, voice: 'my-cloned-voice' })[0].value).toBe('my-cloned-voice');
    expect(voiceOptions(minimax).some((option) => option.value === 'English_CalmWoman')).toBe(true);
    const openai = profileFor(applyProviderPreset(settings, 'provider-openai-tts'), 'tts');
    expect(voiceOptions(openai).some((option) => option.value === 'marin')).toBe(true);
    expect(
      voiceOptions({ ...openai, modelId: 'tts-1' }).some((option) => option.value === 'marin'),
    ).toBe(false);
    const compatible = {
      ...openai,
      baseUrl: 'https://other.example.com/v1',
      voice: 'vendor-voice',
      modelId: 'vendor-model',
    };
    expect(voiceOptions(compatible).map((option) => option.value)).toEqual(['vendor-voice']);
    expect(modelOptions(compatible).map((option) => option.value)).toEqual(['vendor-model']);
    const modern = { ...applyProviderPreset(settings, 'provider-openai-tts') };
    modern.profiles = modern.profiles.map((p) =>
      p.id === modern.active.tts ? { ...p, voice: 'marin' } : p,
    );
    expect(profileFor(updateSpeechProfile(modern, { modelId: 'tts-1' }), 'tts').voice).toBe(
      'alloy',
    );
  });
  it('keeps ASR models specific to the implemented wire protocol', () => {
    const settings = applyProviderPreset(structuredClone(defaults), 'provider-qwen-realtime');
    expect(modelOptions(profileFor(settings, 'asr')).map((option) => option.value)).toEqual([
      'qwen-audio-3.0-asr-flash-streaming',
    ]);
    const http = applyProviderPreset(settings, 'provider-qwen-asr');
    expect(modelOptions(profileFor(http, 'asr')).map((option) => option.value)).toEqual([
      'qwen3-asr-flash',
    ]);
  });
  it('changes the next speech without mutating in-flight settings or credential IDs', () => {
    const original = applyProviderPreset(structuredClone(defaults), 'provider-minimax-cn');
    const next = updateSpeechProfile(original, {
      voice: 'English_CalmWoman',
      modelId: 'speech-2.8-hd',
    });
    expect(profileFor(original, 'tts').voice).toBe('male-qn-qingse');
    expect(profileFor(next, 'tts').id).toBe(profileFor(original, 'tts').id);
    expect(next.active).toEqual(original.active);
    expect(profileFor(next, 'asr')).toBe(profileFor(original, 'asr'));
    expect(profileFor(next, 'translation')).toBe(profileFor(original, 'translation'));
    expect(profileFor(parseSettings(next), 'tts')).toMatchObject({
      voice: 'English_CalmWoman',
      modelId: 'speech-2.8-hd',
    });
  });
});
