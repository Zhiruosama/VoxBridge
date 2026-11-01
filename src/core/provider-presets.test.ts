import { describe, expect, it } from 'vitest';
import { defaults, parseSettings, profileFor, validateProfile } from './settings';
import {
  applyProviderPreset,
  removeProviderProfile,
  usesBuiltinProfileName,
} from './provider-presets';

describe('provider presets', () => {
  it('localizes stock profile names without changing user-defined names', () => {
    const p = profileFor(
      applyProviderPreset(structuredClone(defaults), 'provider-openai-asr'),
      'asr',
    );
    expect(usesBuiltinProfileName(p)).toBe(true);
    expect(usesBuiltinProfileName({ ...p, name: 'Мой OpenAI' })).toBe(false);
    expect(usesBuiltinProfileName({ ...p, id: 'my-profile' })).toBe(false);
  });
  it('persists an independent OpenAI ASR profile and validates its transport and stage', () => {
    const settings = applyProviderPreset(structuredClone(defaults), 'provider-openai-asr');
    const profile = profileFor(parseSettings(JSON.parse(JSON.stringify(settings))), 'asr');
    expect(profile).toMatchObject({
      adapter: 'openai_audio_transcriptions',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'whisper-1',
    });
    expect(validateProfile(profile)).toBeNull();
    expect(validateProfile({ ...profile, baseUrl: 'wss://example.com' })).toBeTruthy();
    expect(validateProfile({ ...profile, baseUrl: 'http://example.com' })).toBeTruthy();
    expect(validateProfile({ ...profile, baseUrl: 'http://127.0.0.1:9000/v1' })).toBeNull();
    expect(settings.active.translation).toBe(defaults.active.translation);
    expect(settings.active.tts).toBe(defaults.active.tts);
    profileFor(settings, 'asr').modelId = 'custom-model';
    expect(profileFor(applyProviderPreset(settings, 'provider-openai-asr'), 'asr').modelId).toBe(
      'custom-model',
    );
    settings.profiles[1].adapter = 'openai_audio_transcriptions';
    expect(() => parseSettings(settings)).toThrow();
  });
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
  it('uses the validated Qwen model with independent ASR credentials', () => {
    const settings = applyProviderPreset(structuredClone(defaults), 'provider-qwen-asr');
    expect(profileFor(parseSettings(settings), 'asr')).toMatchObject({
      id: 'provider-qwen-asr',
      adapter: 'qwen_chat_asr',
      modelId: 'qwen3-asr-flash',
      baseUrl: 'https://maas.qianwenaiapi.com/compatible-mode/v1',
    });
    expect(settings.active.translation).toBe(defaults.active.translation);
    expect(settings.active.tts).toBe(defaults.active.tts);
    expect(JSON.stringify(settings)).not.toContain('apiKey');
  });
  it('round-trips the realtime preset and enforces WebSocket transport', () => {
    const settings = applyProviderPreset(structuredClone(defaults), 'provider-qwen-realtime');
    const profile = profileFor(parseSettings(settings), 'asr');
    expect(profile.adapter).toBe('qwen_dashscope_asr');
    expect(profile.modelId).toBe('qwen-audio-3.0-asr-flash-streaming');
    expect(validateProfile(profile)).toBeNull();
    expect(validateProfile({ ...profile, baseUrl: 'https://example.com' })).toBeTruthy();
    expect(validateProfile({ ...profile, baseUrl: 'ws://example.com' })).toBeTruthy();
    expect(validateProfile({ ...profile, baseUrl: 'ws://127.0.0.1:9000' })).toBeNull();
    expect(validateProfile({ ...profile, baseUrl: 'wss://example.com/?key=secret' })).toBeTruthy();
    expect(settings.active.translation).toBe(defaults.active.translation);
    expect(settings.active.tts).toBe(defaults.active.tts);
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

it('removes a selected service and preserves profiles of other stages across reload', () => {
  const input = applyProviderPreset(structuredClone(defaults), 'provider-deepseek-flash');
  const next = removeProviderProfile(input, 'provider-deepseek-flash', 'fresh-id');
  expect(next.profiles.some((p) => p.id === 'provider-deepseek-flash')).toBe(false);
  expect(next.active.translation).toBe('translation-default');
  expect(next.active.asr).toBe(input.active.asr);
  expect(parseSettings(next).profiles).toEqual(next.profiles);
  expect(input.profiles.some((p) => p.id === 'provider-deepseek-flash')).toBe(true);
});
it('replaces the last service with a fresh empty profile that cannot reuse the deleted key', () => {
  const input = structuredClone(defaults);
  const next = removeProviderProfile(input, 'tts-default', 'fresh-tts');
  expect(next.active.tts).toBe('fresh-tts');
  expect(profileFor(parseSettings(next), 'tts')).toMatchObject({
    id: 'fresh-tts',
    baseUrl: '',
    modelId: '',
    voice: '',
  });
  expect(next.profiles.some((p) => p.id === 'tts-default')).toBe(false);
  expect(() => removeProviderProfile(input, 'tts-default', 'tts-default')).toThrow();
});
