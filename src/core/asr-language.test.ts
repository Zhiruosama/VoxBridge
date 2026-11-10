import { expect, it } from 'vitest';
import { asrLanguages, asrLanguageHint } from './asr-language';
import { defaults, parseSettings, profileFor } from './settings';
import { applyProviderPreset } from './provider-presets';
import { modelOptions, speechProvider } from './speech-presets';

it('persists independent listening and microphone languages without changing translation settings', () => {
  for (const language of asrLanguages) {
    const settings = parseSettings({
      ...defaults,
      listening: { ...defaults.listening, sourceLanguage: language },
      composer: { ...defaults.composer, asrLanguage: '日语' },
    });
    const restored = parseSettings(JSON.parse(JSON.stringify(settings)));
    expect(restored.listening.sourceLanguage).toBe(language);
    expect(restored.composer.asrLanguage).toBe('日语');
    expect(restored.sourceLanguage).toBe(defaults.sourceLanguage);
    expect(restored.targetLanguage).toBe(defaults.targetLanguage);
  }
});

it('keeps legacy recordings automatic and rejects imported invalid language values', () => {
  for (const value of [undefined, null, {}, 'invalid', 'en']) {
    const settings = parseSettings({
      ...defaults,
      composer: { ...defaults.composer, asrLanguage: value },
      listening: { ...defaults.listening, sourceLanguage: value },
    });
    expect(settings.composer.asrLanguage).toBe('自动识别');
    expect(settings.listening.sourceLanguage).toBe('自动识别');
  }
});

it('explains unsupported realtime hints instead of promising a language lock', () => {
  const profile = profileFor(applyProviderPreset(defaults, 'provider-qwen-realtime'), 'asr');
  expect(asrLanguageHint(profile, '粤语')).toContain('不支持限定粤语');
  expect(
    asrLanguageHint({ ...profile, modelId: 'qwen-audio-3.1-asr-flash-streaming' }, '粤语'),
  ).toContain('不会限定');
  expect(asrLanguageHint({ ...profile, modelId: 'custom' }, '英语')).toContain('尚未适配');
  expect(asrLanguageHint(profile, '英语')).toContain('减少误判');
});

it('adds Groq as an opt-in compatible profile and preserves existing Qwen configuration', () => {
  const settings = applyProviderPreset(defaults, 'provider-qwen-realtime');
  const qwen = profileFor(settings, 'asr');
  const changed = parseSettings(applyProviderPreset(settings, 'provider-groq-asr'));
  expect(profileFor(changed, 'asr')).toMatchObject({
    adapter: 'openai_audio_transcriptions',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelId: 'whisper-large-v3-turbo',
  });
  expect(speechProvider(profileFor(changed, 'asr'))).toBe('Groq');
  expect(modelOptions(profileFor(changed, 'asr')).map((option) => option.value)).toEqual([
    'whisper-large-v3-turbo',
    'whisper-large-v3',
  ]);
  expect(changed.profiles.find((p) => p.id === qwen.id)).toEqual(qwen);
  expect(profileFor(settings, 'asr')).toBe(qwen);
});
