import type { ProviderProfile, Settings, Stage } from './types';

export const defaults: Settings = {
  schemaVersion: 1,
  sourceLanguage: '英语',
  targetLanguage: '简体中文',
  theme: 'dark',
  audio: { previewDeviceId: '', sendDeviceId: '' },
  active: { asr: 'asr-default', translation: 'translation-default', tts: 'tts-default' },
  profiles: [
    {
      id: 'asr-default',
      name: '流式语音识别',
      stage: 'asr',
      adapter: 'pending_asr',
      baseUrl: '',
      modelId: '',
      voice: '',
    },
    {
      id: 'translation-default',
      name: 'OpenAI 兼容服务',
      stage: 'translation',
      adapter: 'openai_chat_completions',
      baseUrl: '',
      modelId: '',
      voice: '',
    },
    {
      id: 'tts-default',
      name: 'MiniMax',
      stage: 'tts',
      adapter: 'minimax_tts_ws',
      baseUrl: 'wss://api.minimax.cn/ws/v1/t2a_v2',
      modelId: '',
      voice: '',
    },
  ],
};

export function validateProfile(profile: ProviderProfile): string | null {
  if (!profile.name.trim()) return '请输入服务名称。';
  if (!profile.baseUrl.trim()) return '请输入 API 地址。';
  try {
    const url = new URL(profile.baseUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const protocols = profile.adapter === 'minimax_tts_ws' ? ['wss:'] : ['https:'];
    const localProtocol = profile.adapter === 'minimax_tts_ws' ? 'ws:' : 'http:';
    if (!protocols.includes(url.protocol) && !(local && url.protocol === localProtocol)) {
      return '远程服务请使用 HTTPS / WSS；本机服务可使用 HTTP / WS。';
    }
    if (url.username || url.password || url.search || url.hash)
      return '地址不能包含凭据、查询参数或片段。';
  } catch {
    return '请输入完整、有效的 API 地址。';
  }
  if (!profile.modelId.trim()) return '请输入模型 ID。';
  if (profile.stage === 'tts' && !profile.voice.trim()) return '请输入音色 ID。';
  return null;
}

export function profileFor(settings: Settings, stage: Stage): ProviderProfile {
  return (
    settings.profiles.find((p) => p.id === settings.active[stage]) ??
    settings.profiles.find((p) => p.stage === stage)!
  );
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
          : ['pending_asr'];
    if (!['asr', 'translation', 'tts'].includes(stage) || !adapters.includes(adapter))
      throw new Error('不支持的服务协议。');
    for (const key of ['id', 'name', 'baseUrl', 'modelId', 'voice']) {
      if (typeof p[key] !== 'string') throw new Error('服务配置字段不完整。');
    }
    return {
      id: p.id as string,
      name: p.name as string,
      stage,
      adapter,
      baseUrl: p.baseUrl as string,
      modelId: p.modelId as string,
      voice: p.voice as string,
      ...(stage === 'translation' && ['enabled', 'disabled'].includes(p.thinking as string)
        ? { thinking: p.thinking as 'enabled' | 'disabled' }
        : {}),
    };
  });
  if (profiles.length > 30 || new Set(profiles.map((p) => p.id)).size !== profiles.length)
    throw new Error('服务数量过多或标识重复。');
  const active = input.active as Record<Stage, unknown> | undefined;
  if (
    !active ||
    !(['asr', 'translation', 'tts'] as Stage[]).every((stage) =>
      profiles.some((p) => p.stage === stage && p.id === active[stage]),
    )
  )
    throw new Error('活动服务配置缺失。');
  return {
    schemaVersion: 1,
    audio: {
      previewDeviceId:
        typeof (input.audio as Record<string, unknown> | undefined)?.previewDeviceId === 'string'
          ? (input.audio as Record<string, string>).previewDeviceId
          : '',
      sendDeviceId:
        typeof (input.audio as Record<string, unknown> | undefined)?.sendDeviceId === 'string'
          ? (input.audio as Record<string, string>).sendDeviceId
          : '',
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
