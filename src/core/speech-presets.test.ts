import { describe, expect, it } from 'vitest';
import { defaults, profileFor, parseSettings } from './settings';
import { applyProviderPreset } from './provider-presets';
import {
  modelOptions,
  voiceOptions,
  updateSpeechProfile,
  selectSpeechVoice,
} from './speech-presets';

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

describe('remembered custom speech voices', () => {
  it('keeps new and legacy custom voices selectable after switching and a settings round trip', () => {
    let settings = applyProviderPreset(structuredClone(defaults), 'provider-minimax-cn');
    settings.profiles = settings.profiles.map((p) =>
      p.id === settings.active.tts ? { ...p, voice: 'legacy-clone' } : p,
    );
    const original = structuredClone(settings);
    settings = updateSpeechProfile(settings, { voice: '  new-clone  ' });
    settings = updateSpeechProfile(settings, { voice: 'English_CalmWoman' });
    settings = parseSettings(JSON.parse(JSON.stringify(settings)));
    const profile = profileFor(settings, 'tts');
    expect(profile.voice).toBe('English_CalmWoman');
    expect(profile.voicePresets?.map((p) => p.value)).toEqual(['legacy-clone', 'new-clone']);
    expect(
      voiceOptions(profile)
        .filter((p) => p.group === '我的预设')
        .map((p) => p.value),
    ).toEqual(['legacy-clone', 'new-clone']);
    expect(
      profileFor(updateSpeechProfile(settings, { voice: 'new-clone' }), 'tts').voicePresets,
    ).toEqual(profile.voicePresets);
    expect(profileFor(original, 'tts').voicePresets).toBeUndefined();
  });

  it('preserves preset names, keeps libraries separate, and does not save stock voices', () => {
    const settings = applyProviderPreset(structuredClone(defaults), 'provider-minimax-cn');
    const profile = {
      ...profileFor(settings, 'tts'),
      voice: 'clone-a',
      voicePresets: [{ name: 'My voice', value: 'clone-a', adapter: 'minimax_tts_ws' as const }],
    };
    const selected = selectSpeechVoice(profile, 'clone-a');
    expect(selected.voicePresets).toEqual(profile.voicePresets);
    expect(selectSpeechVoice(selected, 'female-tianmei').voicePresets).toEqual(
      profile.voicePresets,
    );
    const otherAccount = { ...profile, id: 'other-account', voice: '', voicePresets: [] };
    expect(voiceOptions(otherAccount).some((p) => p.value === 'clone-a')).toBe(false);
    expect(selectSpeechVoice(otherAccount, 'clone-b').voicePresets?.map((p) => p.value)).toEqual([
      'clone-b',
    ]);
  });

  it('rejects invalid or overflowing additions without discarding any saved voice', () => {
    const settings = applyProviderPreset(structuredClone(defaults), 'provider-minimax-cn');
    const profile = profileFor(settings, 'tts');
    expect(() => selectSpeechVoice(profile, 'bad\nvoice')).toThrow();
    const full = {
      ...profile,
      voicePresets: Array.from({ length: 50 }, (_, i) => ({
        name: `Voice ${i}`,
        value: `clone-${i}`,
        adapter: profile.adapter,
      })),
    };
    expect(() => selectSpeechVoice(full, 'one-more')).toThrow();
    expect(full.voicePresets).toHaveLength(50);
    expect(selectSpeechVoice(full, 'clone-1').voice).toBe('clone-1');
  });
});
