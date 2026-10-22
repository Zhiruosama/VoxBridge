import { describe, expect, it } from 'vitest';
import { defaults, parseSettings, validateProfile } from './settings';

describe('provider profiles', () => {
  it('migrates old settings without routing and strips unknown audio fields', () => {
    const input = { ...structuredClone(defaults), audio: undefined };
    expect(parseSettings(input).audio).toEqual({ previewDeviceId: '', sendDeviceId: '' });
    const withAudio = {
      ...input,
      audio: { previewDeviceId: 'headphones', sendDeviceId: 'virtual', apiKey: 'never-save' },
    };
    expect(parseSettings(withAudio).audio).toEqual({
      previewDeviceId: 'headphones',
      sendDeviceId: 'virtual',
    });
  });
  it('allows both TTS adapters but requires a voice and matching URL scheme', () => {
    const input = structuredClone(defaults);
    input.profiles[2] = {
      ...input.profiles[2],
      adapter: 'openai_audio_speech',
      baseUrl: 'https://example.com/v1',
      modelId: 'custom',
      voice: 'custom-voice',
    };
    expect(parseSettings(input).profiles[2].adapter).toBe('openai_audio_speech');
    expect(validateProfile(input.profiles[2])).toBeNull();
    expect(validateProfile({ ...input.profiles[2], voice: '' })).toBeTruthy();
    expect(
      validateProfile({ ...input.profiles[2], baseUrl: 'wss://example.com/audio' }),
    ).toBeTruthy();
    input.profiles[1].adapter = 'openai_audio_speech';
    expect(() => parseSettings(input)).toThrow();
  });
  it('strips credentials from imported data and rejects mismatched active profiles', () => {
    const input = structuredClone(defaults);
    Object.assign(input.profiles[1], { apiKey: 'never-save-me' });
    expect(JSON.stringify(parseSettings(input))).not.toContain('never-save-me');
    input.active.translation = input.active.tts;
    expect(() => parseSettings(input)).toThrow();
  });
  it('allows local endpoints but rejects unsafe or credential-bearing URLs', () => {
    const p = { ...defaults.profiles[1], modelId: 'custom', baseUrl: 'http://127.0.0.1:1234/v1' };
    expect(validateProfile(p)).toBeNull();
    expect(validateProfile({ ...p, baseUrl: 'http://example.com/v1' })).toBeTruthy();
    expect(validateProfile({ ...p, baseUrl: 'https://user:pass@example.com/v1' })).toBeTruthy();
    expect(validateProfile({ ...p, baseUrl: 'https://example.com/v1?key=secret' })).toBeTruthy();
  });
});
