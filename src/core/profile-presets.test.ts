import { describe, expect, it } from 'vitest';
import { defaults, parseSettings, profileFor } from './settings';
import { applyProviderPreset } from './provider-presets';
import { editProfilePreset, parseProfilePresets } from './profile-presets';
import { modelOptions, voiceOptions } from './speech-presets';

function fixture() {
  return applyProviderPreset(structuredClone(defaults), 'provider-minimax-cn');
}
describe('user-managed profile preset libraries', () => {
  it('round-trips named models/voices without sharing credentials or leaking extra fields', () => {
    const settings = fixture();
    let profile = profileFor(settings, 'tts');
    profile = editProfilePreset(profile, 'voicePresets', null, {
      name: '  我的声音  ',
      value: ' cloned-01 ',
      adapter: profile.adapter,
    });
    profile = editProfilePreset(profile, 'modelPresets', null, {
      name: '高质量',
      value: 'my-model',
      adapter: profile.adapter,
    });
    settings.profiles = settings.profiles.map((p) => (p.id === profile.id ? profile : p));
    Object.assign(profile.voicePresets![0], { apiKey: 'never-save' });
    const parsed = parseSettings(settings);
    expect(JSON.stringify(parsed)).not.toContain('never-save');
    const next = profileFor(parsed, 'tts');
    expect(next.voicePresets![0]).toEqual({
      name: '我的声音',
      value: 'cloned-01',
      adapter: profile.adapter,
    });
    expect(next.id).toBe(settings.active.tts);
    expect(voiceOptions(next)[0]).toMatchObject({
      label: '我的声音',
      value: 'cloned-01',
      group: '我的预设',
    });
    expect(modelOptions(next).some((o) => o.label === '高质量')).toBe(true);
    expect(
      voiceOptions({ ...next, id: 'another', voicePresets: undefined }).some(
        (o) => o.value === 'cloned-01',
      ),
    ).toBe(false);
  });
  it('supports builtin aliases without duplicate options; edits follow the selected ID and deletion preserves output', () => {
    const initial = profileFor(fixture(), 'tts');
    const added = editProfilePreset(initial, 'voicePresets', null, {
      name: '日常',
      value: initial.voice,
      adapter: initial.adapter,
    });
    expect(voiceOptions(added).filter((o) => o.value === initial.voice)).toHaveLength(1);
    expect(voiceOptions(added)[0].label).toBe('日常');
    const edited = editProfilePreset(added, 'voicePresets', 0, {
      name: '朋友聊天',
      value: 'cloned-new',
      adapter: initial.adapter,
    });
    expect(edited.voice).toBe('cloned-new');
    expect(initial.voicePresets).toBeUndefined();
    const removed = editProfilePreset(edited, 'voicePresets', 0, null);
    expect(removed.voicePresets).toEqual([]);
    expect(removed.voice).toBe('cloned-new');
    expect(voiceOptions(removed)[0]).toMatchObject({ value: 'cloned-new', group: '当前自定义' });
  });
  it('keeps catalogs separate when the protocol changes and leaves other stages intact', () => {
    const p = profileFor(fixture(), 'tts');
    const added = editProfilePreset(p, 'voicePresets', null, {
      name: '私人音色',
      value: 'cloned',
      adapter: p.adapter,
    });
    expect(
      voiceOptions({
        ...added,
        adapter: 'openai_audio_speech',
        voice: 'alloy',
        baseUrl: 'https://api.openai.com/v1',
      }).some((o) => o.value === 'cloned'),
    ).toBe(false);
    expect(() =>
      editProfilePreset(p, 'voicePresets', null, {
        name: '错误',
        value: 'alloy',
        adapter: 'openai_audio_speech',
      }),
    ).toThrow('不匹配');
  });
  it('rejects duplicate IDs, empty or oversized values and oversized libraries', () => {
    const item = { name: '日常', value: 'voice', adapter: 'minimax_tts_ws' as const };
    expect(() => parseProfilePresets([item, item])).toThrow('重复');
    expect(() => parseProfilePresets([{ ...item, value: ' ' }])).toThrow('ID');
    expect(() => parseProfilePresets([{ ...item, value: 'bad\nvalue' }])).toThrow('ID');
    expect(() => parseProfilePresets([{ ...item, value: '中'.repeat(67) }])).toThrow('ID');
    expect(() => parseProfilePresets([{ ...item, name: 'x'.repeat(81) }])).toThrow('名称');
    expect(() => parseProfilePresets(Array(51).fill(item))).toThrow('50');
  });
  it('migrates existing settings without selecting or creating another service', () => {
    expect(parseSettings(defaults)).toEqual(defaults);
  });
});
