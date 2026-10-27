import { defaultTranslationPrompt, translationPromptLimit } from './translation-prompt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaults, loadSettings, parseSettings, saveSettings, validateProfile } from './settings';
import { migrateLegacyOutputRouting } from './audio-routing';

afterEach(() => vi.unstubAllGlobals());

describe('settings recovery', () => {
  it('requires explicit opt-in for automatic updates and preserves existing settings', () => {
    const old = structuredClone(defaults) as Partial<typeof defaults>;
    delete old.automaticUpdates;
    expect(parseSettings(old).automaticUpdates).toBe(false);
    expect(parseSettings({ ...old, automaticUpdates: 'true' }).automaticUpdates).toBe(false);
    const next = parseSettings({ ...old, automaticUpdates: true });
    expect(next.automaticUpdates).toBe(true);
    expect(next.profiles).toEqual(defaults.profiles);
    expect(next.audio).toEqual(defaults.audio);
  });
  function storage() {
    const values = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => values.set(key, value));
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem });
    return { values, setItem };
  }
  it('retains configured profiles and routing when the main record is missing or corrupt', () => {
    const { values } = storage();
    const configured = structuredClone(defaults);
    configured.profiles[0].modelId = 'saved-model';
    configured.audio.inputDeviceId = 'mic:saved';
    saveSettings(configured);
    values.delete('voxbridge.settings.v1');
    expect(loadSettings().profiles[0].modelId).toBe('saved-model');
    values.set('voxbridge.settings.v1', '{broken');
    expect(loadSettings().audio.inputDeviceId).toBe('mic:saved');
    expect(values.get('voxbridge.settings.v1')).toBe('{broken');
  });
  it('keeps unreadable data and the previous valid backup when saving after recovery', () => {
    const { values } = storage();
    saveSettings(structuredClone(defaults));
    const valid = values.get('voxbridge.settings.v1.backup');
    values.set('voxbridge.settings.v1', '{broken');
    const recovered = loadSettings();
    recovered.theme = 'light';
    saveSettings(recovered);
    expect(values.get('voxbridge.settings.v1.unreadable')).toBe('{broken');
    expect(values.get('voxbridge.settings.v1.backup')).toBe(valid);
    expect(loadSettings().theme).toBe('light');
  });
  it('does not overwrite current settings when the backup write fails', () => {
    const { values, setItem } = storage();
    saveSettings(structuredClone(defaults));
    const original = values.get('voxbridge.settings.v1');
    setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveSettings({ ...defaults, theme: 'light' })).toThrow('quota');
    expect(values.get('voxbridge.settings.v1')).toBe(original);
  });
});

describe('provider profiles', () => {
  it('migrates and persists workspace font size independently of floating captions', () => {
    for (const value of [undefined, null, '24', NaN, Infinity]) {
      expect(parseSettings({ ...defaults, captionFontSize: value }).captionFontSize).toBe(17);
    }
    expect(parseSettings({ ...defaults, captionFontSize: 1 }).captionFontSize).toBe(12);
    expect(parseSettings({ ...defaults, captionFontSize: 99 }).captionFontSize).toBe(32);
    expect(parseSettings({ ...defaults, captionFontSize: 22.6 }).captionFontSize).toBe(23);
    let stored = '';
    vi.stubGlobal('localStorage', {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    });
    saveSettings({ ...structuredClone(defaults), captionFontSize: 24 });
    expect(loadSettings().captionFontSize).toBe(24);
    expect(loadSettings().subtitle).toEqual(defaults.subtitle);
  });
  it('persists upgraded Windows output IDs across restart without changing provider settings', () => {
    let stored = JSON.stringify({
      ...structuredClone(defaults),
      audio: { previewDeviceId: 'Headphones', sendDeviceId: 'Cable', monitorEnabled: true },
    });
    vi.stubGlobal('localStorage', {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    });
    const before = loadSettings();
    const audio = migrateLegacyOutputRouting(before.audio, [
      { id: 'windows-output:61', name: 'Headphones' },
      { id: 'windows-output:62', name: 'Cable' },
    ]);
    saveSettings({ ...before, audio });
    expect(loadSettings()).toEqual({ ...before, audio });
    expect(loadSettings().audio.previewDeviceId).toBe('windows-output:61');
    expect(loadSettings().audio.sendDeviceId).toBe('windows-output:62');
  });
  it('migrates and bounds workspace caption spacing independently of overlay line height', () => {
    expect(parseSettings({ ...defaults, captionSpacing: undefined }).captionSpacing).toBe(26);
    for (const value of [null, '20', NaN, Infinity]) {
      expect(parseSettings({ ...defaults, captionSpacing: value }).captionSpacing).toBe(26);
    }
    expect(parseSettings({ ...defaults, captionSpacing: -10 }).captionSpacing).toBe(8);
    expect(parseSettings({ ...defaults, captionSpacing: 1000 }).captionSpacing).toBe(64);
    const restored = parseSettings(JSON.parse(JSON.stringify({ ...defaults, captionSpacing: 18 })));
    expect(restored.captionSpacing).toBe(18);
    expect(restored.subtitle).toEqual(defaults.subtitle);
  });

  it('migrates old settings without routing and strips unknown audio fields', () => {
    const input = { ...structuredClone(defaults), audio: undefined };
    expect(parseSettings(input).audio).toEqual({
      previewDeviceId: '__system_default__',
      sendDeviceId: '__virtual_microphone__',
      monitorEnabled: false,
    });
    const withAudio = {
      ...input,
      audio: { previewDeviceId: 'headphones', sendDeviceId: 'virtual', apiKey: 'never-save' },
    };
    expect(parseSettings(withAudio).audio).toEqual({
      previewDeviceId: 'headphones',
      sendDeviceId: 'virtual',
      monitorEnabled: false,
    });
  });
  it('defaults sending to a virtual microphone, previews to the system, and preserves explicit routes', () => {
    const settings = structuredClone(defaults);
    settings.audio.previewDeviceId = '';
    settings.audio.sendDeviceId = '';
    expect(parseSettings(settings).audio.previewDeviceId).toBe('__system_default__');
    expect(parseSettings(settings).audio.sendDeviceId).toBe('__virtual_microphone__');
    expect(parseSettings(defaults).audio.previewDeviceId).toBe('__system_default__');
    expect(parseSettings(defaults).audio.sendDeviceId).toBe('__virtual_microphone__');
    for (const id of [
      '__system_default__',
      '__virtual_microphone__',
      'windows-output:61',
      'macos-output:61',
      'disconnected-device',
    ]) {
      settings.audio.sendDeviceId = id;
      expect(parseSettings(settings).audio.sendDeviceId).toBe(id);
    }
  });
  it('persists only a boolean monitoring preference without changing selected audio devices', () => {
    const settings = structuredClone(defaults);
    settings.audio = {
      previewDeviceId: 'headphones',
      sendDeviceId: 'virtual',
      monitorEnabled: true,
    };
    expect(parseSettings(settings).audio).toEqual(settings.audio);
    expect(
      parseSettings({ ...settings, audio: { ...settings.audio, monitorEnabled: 'true' } }).audio
        .monitorEnabled,
    ).toBe(false);
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
  it('preserves incomplete profiles without requiring a model or voice', () => {
    const input = structuredClone(defaults);
    for (const profile of input.profiles) {
      profile.baseUrl = '';
      profile.modelId = '';
      profile.voice = '';
    }
    expect(parseSettings(input)).toEqual(input);
    input.profiles[1].baseUrl = 'https://example.com/v1';
    expect(parseSettings(input)).toEqual(input);
    expect(validateProfile(input.profiles[1])).toBe('请输入模型 ID。');
  });
  it.each([
    'https://user@example.com/v1',
    'https://user:never-save@example.com/v1',
    'https://@example.com/v1',
    'https://:@example.com/v1',
    'https:\t//:@example.com/v1',
    'https://example.com/v1?key=never-save',
    'https://example.com/v1#never-save',
    'https://example.com/v1?',
    'https://example.com/v1#',
    'http://example.com/v1',
    'file:///private/config',
    'not a URL',
  ])('rejects an unsafe URL even in an inactive profile: %s', (baseUrl) => {
    const input = structuredClone(defaults);
    input.profiles.push({ ...input.profiles[1], id: 'inactive', baseUrl });
    expect(() => parseSettings(input)).toThrow();
  });
  it.each([
    ['translation', 'https://example.com/v1'],
    ['translation', 'https://example.com/v1/%3F%23'],
    ['translation', 'https://example.com/v1/@model'],
    ['translation', 'http://127.0.0.1:9000/v1'],
    ['translation', 'http://[::1]:9000/v1'],
    ['tts', 'wss://example.com/audio'],
    ['tts', 'ws://localhost:9000/audio'],
    ['asr', 'wss://example.com/asr'],
    ['asr', 'https://example.com/asr'],
  ])('allows a safe %s endpoint in incomplete settings: %s', (stage, baseUrl) => {
    const input = structuredClone(defaults);
    input.profiles.find((profile) => profile.stage === stage)!.baseUrl = baseUrl;
    expect(parseSettings(input)).toEqual(input);
  });
  it('rejects unsafe settings before writing and preserves the stored value', () => {
    const previous = JSON.stringify(defaults);
    const setItem = vi.fn();
    const getItem = vi.fn(() => previous);
    vi.stubGlobal('localStorage', { setItem, getItem });
    const input = structuredClone(defaults);
    input.profiles[1].baseUrl = 'https://user:never-save@example.com/v1';
    expect(() => saveSettings(input)).toThrow('地址不能包含凭据、查询参数或片段。');
    expect(setItem).not.toHaveBeenCalled();
    expect(loadSettings()).toEqual(defaults);
  });
  it('round-trips safe incomplete settings without imported credential fields', () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      setItem: (key: string, value: string) => stored.set(key, value),
      getItem: (key: string) => stored.get(key) ?? null,
    });
    const input = structuredClone(defaults);
    Object.assign(input.profiles[1], { apiKey: 'never-save' });
    saveSettings(input);
    expect(loadSettings()).toEqual(defaults);
    expect([...stored.values()].join('')).not.toContain('never-save');
  });
  it('accepts Qwen HTTP ASR profiles but rejects cross-stage or WebSocket schemes', () => {
    const input = structuredClone(defaults);
    input.profiles[0] = {
      ...input.profiles[0],
      adapter: 'qwen_chat_asr',
      baseUrl: 'https://example.com/compatible-mode/v1',
      modelId: 'qwen3-asr-flash',
    };
    expect(parseSettings(input)).toEqual(input);
    expect(validateProfile(input.profiles[0])).toBeNull();
    input.profiles[0].baseUrl = 'wss://example.com/asr';
    expect(() => parseSettings(input)).toThrow();
    input.profiles[0].baseUrl = '';
    expect(parseSettings(input)).toEqual(input);
    input.profiles[1].adapter = 'qwen_chat_asr';
    expect(() => parseSettings(input)).toThrow();
  });
  it('migrates subtitle appearance and never stores subtitle snapshots', () => {
    const input = { ...structuredClone(defaults), subtitle: undefined };
    expect(parseSettings(input).subtitle).toEqual(defaults.subtitle);
    const imported = {
      ...input,
      subtitle: { fontSize: 100, backgroundOpacity: NaN, lines: ['private-transcript'] },
    };
    const parsed = parseSettings(imported);
    expect(parsed.subtitle).toEqual({ ...defaults.subtitle, fontSize: 40 });
    expect(JSON.stringify(parsed)).not.toContain('private-transcript');
  });
  it('migrates composer preferences and strips unknown fields', () => {
    expect(parseSettings({ ...defaults, composer: undefined }).composer).toEqual(defaults.composer);
    expect(
      parseSettings({ ...defaults, composer: { enterAction: 'bad', output: 'bad', route: 'bad' } })
        .composer,
    ).toEqual(defaults.composer);
    expect(
      parseSettings({
        ...defaults,
        composer: {
          enterAction: 'newline',
          output: 'source',
          route: 'preview',
          apiKey: 'never-save',
        },
      }).composer,
    ).toEqual({
      voiceInputMode: 'dictate',
      enterAction: 'newline',
      output: 'source',
      route: 'preview',
    });
  });
  it('round-trips composer preferences through storage', () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    const input = structuredClone(defaults);
    input.composer = {
      voiceInputMode: 'send',
      enterAction: 'translate',
      output: 'source',
      route: 'preview',
    };
    saveSettings(input);
    expect(loadSettings().composer).toEqual(input.composer);
  });
  it('allows local endpoints but rejects unsafe or credential-bearing URLs', () => {
    const p = { ...defaults.profiles[1], modelId: 'custom', baseUrl: 'http://127.0.0.1:1234/v1' };
    expect(validateProfile(p)).toBeNull();
    expect(validateProfile({ ...p, baseUrl: 'http://example.com/v1' })).toBeTruthy();
    expect(validateProfile({ ...p, baseUrl: 'https://user:pass@example.com/v1' })).toBeTruthy();
    expect(validateProfile({ ...p, baseUrl: 'https://example.com/v1?key=secret' })).toBeTruthy();
  });
});

describe('empty current configuration isolation', () => {
  it('never selects an existing template when the current selection is empty or missing', async () => {
    const { profileFor } = await import('./settings');
    const input = structuredClone(defaults);
    input.profiles.push({
      ...input.profiles[1],
      id: 'saved-provider',
      name: 'saved template',
      baseUrl: 'https://example.com',
      modelId: 'saved-model',
    });
    input.active.translation = '';
    const parsed = parseSettings(input);
    const current = profileFor(parsed, 'translation');
    expect(current.id).not.toBe('saved-provider');
    expect(current.baseUrl).toBe('');
    expect(current.modelId).toBe('');
    expect(parsed.profiles.find((p) => p.id === 'saved-provider')?.modelId).toBe('saved-model');
    expect(profileFor(input, 'translation').modelId).toBe('');
  });
  it('creates blank stages for a fresh empty configuration and preserves hand-entered incomplete fields', () => {
    const parsed = parseSettings({ ...structuredClone(defaults), profiles: [], active: {} });
    expect(parsed.profiles).toHaveLength(3);
    expect(
      parsed.profiles.every((profile) => !profile.baseUrl && !profile.modelId && !profile.voice),
    ).toBe(true);
    parsed.profiles[1].baseUrl = 'https://my-api.example.com';
    expect(parseSettings(parsed)).toEqual(parsed);
  });
});

it('migrates listening direction independently from the saved text-expression pair', () => {
  const old = {
    ...structuredClone(defaults),
    sourceLanguage: '简体中文',
    targetLanguage: '英语',
  } as Record<string, unknown>;
  delete old.listening;
  const parsed = parseSettings(old);
  expect(parsed.listening).toEqual({ sourceLanguage: '自动识别', targetLanguage: '简体中文' });
  expect(parsed.sourceLanguage).toBe('简体中文');
  expect(parsed.targetLanguage).toBe('英语');
  expect(
    parseSettings({ ...parsed, listening: { sourceLanguage: '日语', targetLanguage: '韩语' } })
      .listening,
  ).toEqual({ sourceLanguage: '日语', targetLanguage: '韩语' });
});

describe('translation style prompt', () => {
  it('migrates an older configuration to the casual default without changing the active model', () => {
    const settings = structuredClone(defaults);
    delete settings.profiles[1].translationPrompt;
    const parsed = parseSettings(settings);
    expect(parsed.profiles[1].translationPrompt).toBe(defaultTranslationPrompt);
    expect(parsed.active).toEqual(settings.active);
    expect(defaultTranslationPrompt).toContain('Instagram');
    expect(defaultTranslationPrompt).toContain('Discord');
  });
  it('round-trips custom text and explicit empty values per profile', () => {
    const settings = structuredClone(defaults);
    settings.profiles[1].translationPrompt = 'Keep it casual. "Quotes"\nAnd emojis 🙂';
    settings.profiles.push({ ...settings.profiles[1], id: 'other', translationPrompt: '' });
    const parsed = parseSettings(JSON.parse(JSON.stringify(settings)));
    expect(parsed.profiles[1].translationPrompt).toBe(settings.profiles[1].translationPrompt);
    expect(parsed.profiles[3].translationPrompt).toBe('');
    expect(parsed.profiles[0].translationPrompt).toBeUndefined();
  });
  it('rejects invalid types and oversized prompts, including inactive profiles', () => {
    const settings = structuredClone(defaults);
    settings.profiles.push({
      ...settings.profiles[1],
      id: 'inactive',
      translationPrompt: '字'.repeat(translationPromptLimit + 1),
    });
    expect(() => parseSettings(settings)).toThrow('Prompt');
    settings.profiles[3].translationPrompt = 42 as unknown as string;
    expect(() => parseSettings(settings)).toThrow('Prompt');
    settings.profiles[3].translationPrompt = '字'.repeat(translationPromptLimit);
    expect(parseSettings(settings).profiles[3].translationPrompt).toHaveLength(
      translationPromptLimit,
    );
  });
});

it('defaults both caption groups to white when upgrading older settings', () => {
  const old = { ...defaults, captionColors: undefined };
  expect(parseSettings(old).captionColors).toEqual({
    recognition: '#ffffff',
    expression: '#ffffff',
  });
});
it('round-trips independent caption colors without changing service selections', () => {
  const settings = {
    ...structuredClone(defaults),
    captionColors: { recognition: '#80DEEA', expression: '#f8bbd0' },
  };
  const loaded = parseSettings(JSON.parse(JSON.stringify(settings)));
  expect(loaded.captionColors).toEqual({ recognition: '#80deea', expression: '#f8bbd0' });
  expect(loaded.active).toEqual(settings.active);
});
it('rejects malformed caption color values rather than injecting CSS', () => {
  const loaded = parseSettings({
    ...defaults,
    captionColors: { recognition: 'url(https://example.com)', expression: '#fff; color:red' },
  });
  expect(loaded.captionColors).toEqual({ recognition: '#ffffff', expression: '#ffffff' });
});

it('preserves microphone choice and defaults voice input to editable dictation', () => {
  const legacy = parseSettings({ ...defaults, composer: { enterAction: 'speak' } });
  expect(legacy.composer.voiceInputMode).toBe('dictate');
  const configured = parseSettings({
    ...defaults,
    audio: { ...defaults.audio, inputDeviceId: 'mic:external' },
    composer: { ...defaults.composer, voiceInputMode: 'send' },
  });
  expect(parseSettings(JSON.parse(JSON.stringify(configured))).audio.inputDeviceId).toBe(
    'mic:external',
  );
  expect(configured.composer.voiceInputMode).toBe('send');
});

it('persists per-profile speech speed and migrates old profiles to normal speed', () => {
  const settings = structuredClone(defaults);
  delete settings.profiles[2].speed;
  expect(parseSettings(settings).profiles[2].speed).toBe(1);
  settings.profiles[2].speed = 1.35;
  expect(parseSettings(JSON.parse(JSON.stringify(settings))).profiles[2].speed).toBe(1.35);
  for (const speed of [0.49, 2.01, NaN, Infinity, '1.2']) {
    expect(() =>
      parseSettings({
        ...settings,
        profiles: settings.profiles.map((p) => (p.stage === 'tts' ? { ...p, speed } : p)),
      }),
    ).toThrow();
  }
});

it('retains Indonesian for incoming captions and outgoing speech after settings reload', () => {
  const settings = structuredClone(defaults);
  settings.sourceLanguage = '印尼语';
  settings.targetLanguage = '印尼语';
  settings.listening = { sourceLanguage: '印尼语', targetLanguage: '印尼语' };
  const restored = parseSettings(JSON.parse(JSON.stringify(settings)));
  expect(restored.sourceLanguage).toBe('印尼语');
  expect(restored.targetLanguage).toBe('印尼语');
  expect(restored.listening).toEqual(settings.listening);
});

it('retains Cantonese across reload for both caption and speech settings', () => {
  const settings = structuredClone(defaults);
  settings.sourceLanguage = '粤语';
  settings.targetLanguage = '粤语';
  settings.listening = { sourceLanguage: '粤语', targetLanguage: '粤语' };
  const restored = parseSettings(settings);
  expect(restored.sourceLanguage).toBe('粤语');
  expect(restored.targetLanguage).toBe('粤语');
  expect(restored.listening).toEqual(settings.listening);
});

it('retains Finnish for incoming captions and outgoing speech after reload', () => {
  const settings = structuredClone(defaults);
  settings.sourceLanguage = '芬兰语';
  settings.targetLanguage = '芬兰语';
  settings.listening = { sourceLanguage: '自动识别', targetLanguage: '芬兰语' };
  const restored = parseSettings(JSON.parse(JSON.stringify(settings)));
  expect(restored.sourceLanguage).toBe('芬兰语');
  expect(restored.targetLanguage).toBe('芬兰语');
  expect(restored.listening).toEqual(settings.listening);
});

it('retains Russian for incoming captions and outgoing speech after reload', () => {
  const settings = structuredClone(defaults);
  settings.sourceLanguage = '俄语';
  settings.targetLanguage = '俄语';
  settings.listening = { sourceLanguage: '自动识别', targetLanguage: '俄语' };
  const restored = parseSettings(JSON.parse(JSON.stringify(settings)));
  expect(restored.sourceLanguage).toBe('俄语');
  expect(restored.targetLanguage).toBe('俄语');
  expect(restored.listening).toEqual(settings.listening);
});

it('retains German for incoming captions and outgoing speech after reload', () => {
  const settings = structuredClone(defaults);
  settings.sourceLanguage = '德语';
  settings.targetLanguage = '德语';
  settings.listening = { sourceLanguage: '自动识别', targetLanguage: '德语' };
  const restored = parseSettings(JSON.parse(JSON.stringify(settings)));
  expect(restored.sourceLanguage).toBe('德语');
  expect(restored.targetLanguage).toBe('德语');
  expect(restored.listening).toEqual(settings.listening);
});

it('defaults old settings to background hiding and persists an explicit quit preference', () => {
  expect(
    parseSettings({ ...defaults, mainWindowCloseBehavior: undefined }).mainWindowCloseBehavior,
  ).toBe('hide');
  expect(
    parseSettings({ ...defaults, mainWindowCloseBehavior: 'quit' }).mainWindowCloseBehavior,
  ).toBe('quit');
  expect(
    parseSettings({ ...defaults, mainWindowCloseBehavior: 'invalid' }).mainWindowCloseBehavior,
  ).toBe('hide');
});

describe('text overlay appearance', () => {
  it('migrates old settings and persists independent window appearance', () => {
    const legacy = parseSettings({ ...defaults, textOverlay: undefined });
    expect(legacy.textOverlay).toEqual({
      backgroundOpacity: 0.9,
      fontSize: 17,
      lineHeight: 1.7,
      textColor: '#f5f5f7',
    });
    const appearance = {
      backgroundOpacity: 0.35,
      fontSize: 28,
      lineHeight: 2,
      textColor: '#80deea',
    };
    const restored = parseSettings(
      JSON.parse(JSON.stringify({ ...defaults, textOverlay: appearance })),
    );
    expect(restored.textOverlay).toEqual(appearance);
    expect(restored.subtitle).toEqual(defaults.subtitle);
  });
  it('bounds appearance and rejects invalid colors and non-finite values', () => {
    expect(
      parseSettings({
        ...defaults,
        textOverlay: { fontSize: 999, backgroundOpacity: -1, lineHeight: 99, textColor: 'red' },
      }).textOverlay,
    ).toEqual({ fontSize: 40, backgroundOpacity: 0.2, lineHeight: 2.2, textColor: '#f5f5f7' });
    expect(
      parseSettings({ ...defaults, textOverlay: { fontSize: NaN, backgroundOpacity: Infinity } })
        .textOverlay,
    ).toEqual(defaults.textOverlay);
  });
});
