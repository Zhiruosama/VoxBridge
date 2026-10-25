import { parseUiLanguage } from '../i18n';
import { systemDefaultOutputId } from './audio-routing';
import { defaultTranslationPrompt, translationPromptLimit } from './translation-prompt';
import type { ComposerSettings, ProviderProfile, Settings, Stage } from './types';
import { parseSubtitleAppearance, subtitleDefaults } from './overlay';
import { parseProfilePresets } from './profile-presets';

import { captionColorDefaults, parseCaptionColors } from './caption-colors';
export { captionColorDefaults } from './caption-colors';

export const defaults: Settings = {
  uiLanguage: 'zh-CN',
  schemaVersion: 1,
  sourceLanguage: '简体中文',
  targetLanguage: '英语',
  listening: { sourceLanguage: '自动识别', targetLanguage: '简体中文' },
  theme: 'dark',
  captionColors: { ...captionColorDefaults },
  captionSpacing: 26,
  audio: {
    previewDeviceId: systemDefaultOutputId,
    sendDeviceId: systemDefaultOutputId,
    monitorEnabled: false,
  },
  subtitle: { ...subtitleDefaults },
  composer: {
    voiceInputMode: 'dictate',
    enterAction: 'speak',
    output: 'translation',
    route: 'send',
  },
  active: { asr: 'asr-default', translation: 'translation-default', tts: 'tts-default' },
  profiles: [
    {
      id: 'asr-default',
      name: '空白配置',
      stage: 'asr',
      adapter: 'pending_asr',
      baseUrl: '',
      modelId: '',
      voice: '',
    },
    {
      translationPrompt: defaultTranslationPrompt,
      id: 'translation-default',
      name: '空白配置',
      stage: 'translation',
      adapter: 'openai_chat_completions',
      baseUrl: '',
      modelId: '',
      voice: '',
    },
    {
      id: 'tts-default',
      name: '空白配置',
      stage: 'tts',
      adapter: 'minimax_tts_ws',
      speed: 1,
      baseUrl: '',
      modelId: '',
      voice: '',
    },
  ],
};

export function blankProfile(stage: Stage, id: string): ProviderProfile {
  return {
    ...defaults.profiles.find((profile) => profile.stage === stage)!,
    id,
    name: '空白配置',
    baseUrl: '',
    modelId: '',
    voice: '',
  };
}

function validateEndpoint(baseUrl: string, adapter: ProviderProfile['adapter']): string | null {
  if (!baseUrl.trim()) return null;
  try {
    const url = new URL(baseUrl);
    const authority = baseUrl
      .trim()
      .replace(/[\t\r\n]/g, '')
      .match(/^[a-z][a-z\d+.-]*:[/\\]*([^/\\?#]*)/i)?.[1];
    if (
      authority?.includes('@') ||
      url.username ||
      url.password ||
      url.href.includes('?') ||
      url.href.includes('#')
    )
      return '地址不能包含凭据、查询参数或片段。';
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const protocols =
      adapter === 'pending_asr'
        ? ['https:', 'wss:']
        : adapter === 'minimax_tts_ws' || adapter === 'qwen_dashscope_asr'
          ? ['wss:']
          : ['https:'];
    const secureProtocol =
      url.protocol === 'ws:' ? 'wss:' : url.protocol === 'http:' ? 'https:' : '';
    if (!protocols.includes(url.protocol) && !(local && protocols.includes(secureProtocol)))
      return '远程服务请使用 HTTPS / WSS；本机服务可使用 HTTP / WS。';
  } catch {
    return '请输入完整、有效的 API 地址。';
  }
  return null;
}

export function validateProfile(profile: ProviderProfile): string | null {
  if (
    profile.stage === 'translation' &&
    [...(profile.translationPrompt ?? '')].length > translationPromptLimit
  )
    return `前置 Prompt 最多 ${translationPromptLimit} 字符。`;
  if (
    profile.stage === 'tts' &&
    profile.speed !== undefined &&
    (!Number.isFinite(profile.speed) || profile.speed < 0.5 || profile.speed > 2)
  )
    return '语速应在 0.5–2.0 倍之间。';
  if (!profile.name.trim()) return '请输入服务名称。';
  if (!profile.baseUrl.trim()) return '请输入 API 地址。';
  const invalid = validateEndpoint(profile.baseUrl, profile.adapter);
  if (invalid) return invalid;
  if (!profile.modelId.trim()) return '请输入模型 ID。';
  if (profile.stage === 'tts' && !profile.voice.trim()) return '请输入音色 ID。';
  return null;
}

export function profileFor(settings: Settings, stage: Stage): ProviderProfile {
  return (
    settings.profiles.find((p) => p.id === settings.active[stage] && p.stage === stage) ?? {
      ...defaults.profiles.find((p) => p.stage === stage)!,
      id: `${stage}-empty`,
      baseUrl: '',
      modelId: '',
      voice: '',
    }
  );
}

function parseComposerSettings(value: unknown): ComposerSettings {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    voiceInputMode: input.voiceInputMode === 'send' ? 'send' : 'dictate',
    enterAction: ['speak', 'translate', 'newline'].includes(input.enterAction as string)
      ? (input.enterAction as ComposerSettings['enterAction'])
      : defaults.composer.enterAction,
    output: input.output === 'source' ? 'source' : 'translation',
    route: input.route === 'preview' ? 'preview' : 'send',
  };
}

/** Parse only known fields: never persist an imported credential or arbitrary extra fields. */
export function parseSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') throw new Error('设置文件无效。');
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1 || !Array.isArray(input.profiles))
    throw new Error('不支持的设置版本。');
  const profiles: ProviderProfile[] = input.profiles.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('服务配置无效。');
    const p = item as Record<string, unknown>;
    const stage = p.stage as Stage;
    const adapter = p.adapter as ProviderProfile['adapter'];
    const adapters =
      stage === 'translation'
        ? ['openai_chat_completions']
        : stage === 'tts'
          ? ['minimax_tts_ws', 'openai_audio_speech']
          : ['pending_asr', 'qwen_chat_asr', 'qwen_dashscope_asr'];
    if (!['asr', 'translation', 'tts'].includes(stage) || !adapters.includes(adapter))
      throw new Error('不支持的服务协议。');
    for (const key of ['id', 'name', 'baseUrl', 'modelId', 'voice']) {
      if (typeof p[key] !== 'string') throw new Error('服务配置字段不完整。');
    }
    if (
      stage === 'translation' &&
      p.translationPrompt !== undefined &&
      (typeof p.translationPrompt !== 'string' ||
        [...p.translationPrompt].length > translationPromptLimit)
    )
      throw new Error(`前置 Prompt 必须是最多 ${translationPromptLimit} 字符的文本。`);
    if (
      stage === 'tts' &&
      p.speed !== undefined &&
      (typeof p.speed !== 'number' || !Number.isFinite(p.speed) || p.speed < 0.5 || p.speed > 2)
    )
      throw new Error('语速应在 0.5–2.0 倍之间。');
    const invalid = validateEndpoint(p.baseUrl as string, adapter);
    if (invalid) throw new Error(invalid);
    return {
      id: p.id as string,
      name: p.name as string,
      stage,
      adapter,
      baseUrl: p.baseUrl as string,
      modelId: p.modelId as string,
      voice: p.voice as string,
      ...(stage === 'tts' ? { speed: (p.speed as number | undefined) ?? 1 } : {}),
      ...(p.modelPresets !== undefined
        ? { modelPresets: parseProfilePresets(p.modelPresets) }
        : {}),
      ...(stage === 'tts' && p.voicePresets !== undefined
        ? { voicePresets: parseProfilePresets(p.voicePresets) }
        : {}),
      ...(stage === 'translation'
        ? {
            translationPrompt:
              typeof p.translationPrompt === 'string'
                ? p.translationPrompt
                : defaultTranslationPrompt,
          }
        : {}),
      ...(stage === 'translation' && ['enabled', 'disabled'].includes(p.thinking as string)
        ? { thinking: p.thinking as 'enabled' | 'disabled' }
        : {}),
    };
  });
  if (profiles.length > 30 || new Set(profiles.map((p) => p.id)).size !== profiles.length)
    throw new Error('服务数量过多或标识重复。');
  const suppliedActive =
    input.active && typeof input.active === 'object'
      ? (input.active as Record<Stage, unknown>)
      : ({} as Record<Stage, unknown>);
  const active = {} as Record<Stage, string>;
  for (const stage of ['asr', 'translation', 'tts'] as Stage[]) {
    const selected = profiles.find((profile) => profile.id === suppliedActive[stage]);
    if (selected && selected.stage !== stage) throw new Error('活动服务配置类型不匹配。');
    if (selected) active[stage] = selected.id;
    else {
      let id = `${stage}-empty`;
      while (profiles.some((p) => p.id === id)) id += '-new';
      if (profiles.length >= 30) throw new Error('配置数量已达上限，无法创建空白配置。');
      profiles.push({
        ...defaults.profiles.find((p) => p.stage === stage)!,
        id,
        baseUrl: '',
        modelId: '',
        voice: '',
      });
      active[stage] = id;
    }
  }
  return {
    schemaVersion: 1,
    captionColors: parseCaptionColors(input.captionColors),
    captionSpacing:
      typeof input.captionSpacing === 'number' && Number.isFinite(input.captionSpacing)
        ? Math.min(64, Math.max(8, Math.round(input.captionSpacing)))
        : defaults.captionSpacing,
    subtitle: parseSubtitleAppearance(input.subtitle),
    composer: parseComposerSettings(input.composer),
    listening: {
      sourceLanguage: [
        '自动识别',
        '英语',
        '简体中文',
        '日语',
        '韩语',
        '西班牙语',
        '印尼语',
        '粤语',
        '芬兰语',
        '俄语',
        '德语',
      ].includes((input.listening as Record<string, unknown> | undefined)?.sourceLanguage as string)
        ? (input.listening as Record<string, string>).sourceLanguage
        : defaults.listening.sourceLanguage,
      targetLanguage: [
        '英语',
        '简体中文',
        '日语',
        '韩语',
        '西班牙语',
        '印尼语',
        '粤语',
        '芬兰语',
        '俄语',
        '德语',
      ].includes((input.listening as Record<string, unknown> | undefined)?.targetLanguage as string)
        ? (input.listening as Record<string, string>).targetLanguage
        : defaults.listening.targetLanguage,
    },
    audio: {
      ...(typeof (input.audio as Record<string, unknown> | undefined)?.inputDeviceId === 'string'
        ? { inputDeviceId: (input.audio as Record<string, string>).inputDeviceId }
        : {}),
      monitorEnabled: (input.audio as Record<string, unknown> | undefined)?.monitorEnabled === true,
      previewDeviceId:
        typeof (input.audio as Record<string, unknown> | undefined)?.previewDeviceId === 'string'
          ? (input.audio as Record<string, string>).previewDeviceId || systemDefaultOutputId
          : systemDefaultOutputId,
      sendDeviceId:
        typeof (input.audio as Record<string, unknown> | undefined)?.sendDeviceId === 'string'
          ? (input.audio as Record<string, string>).sendDeviceId || systemDefaultOutputId
          : systemDefaultOutputId,
    },
    profiles,
    active: {
      asr: active.asr as string,
      translation: active.translation as string,
      tts: active.tts as string,
    },
    sourceLanguage:
      typeof input.sourceLanguage === 'string' ? input.sourceLanguage : defaults.sourceLanguage,
    targetLanguage:
      typeof input.targetLanguage === 'string' ? input.targetLanguage : defaults.targetLanguage,
    uiLanguage: parseUiLanguage(input.uiLanguage),
    theme: ['dark', 'light', 'system'].includes(input.theme as string)
      ? (input.theme as Settings['theme'])
      : 'dark',
  };
}

const storageKey = 'voxbridge.settings.v1';
export function loadSettings(): Settings {
  const raw = localStorage.getItem(storageKey);
  return raw ? parseSettings(JSON.parse(raw)) : structuredClone(defaults);
}
export function saveSettings(settings: Settings) {
  localStorage.setItem(storageKey, JSON.stringify(parseSettings(settings)));
}
