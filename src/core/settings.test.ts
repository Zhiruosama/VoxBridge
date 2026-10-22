import { describe, expect, it } from 'vitest';
import { defaults, parseSettings, validateProfile } from './settings';

describe('provider profiles', () => {
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
