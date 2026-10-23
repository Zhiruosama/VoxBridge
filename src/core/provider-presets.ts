import type { ProviderProfile, Settings } from './types';

// Public connection settings only. Credentials are held separately by the OS.
export const providerPresets: ProviderProfile[] = [
  {
    id: 'provider-qwen-asr',
    name: 'Qwen ASR · HTTP 短音频',
    stage: 'asr',
    adapter: 'qwen_chat_asr',
    baseUrl: 'https://maas.qianwenaiapi.com/compatible-mode/v1',
    modelId: 'qwen3-asr-flash',
    voice: '',
  },
  {
    id: 'provider-deepseek-flash',
    name: 'DeepSeek V4.1 Flash',
    stage: 'translation',
    adapter: 'openai_chat_completions',
    baseUrl: 'https://api.deepseek.com',
    modelId: 'deepseek-flash',
    voice: '',
    thinking: 'disabled',
  },
  {
    id: 'provider-minimax-cn',
    name: 'MiniMax Speech 2.8',
    stage: 'tts',
    adapter: 'minimax_tts_ws',
    baseUrl: 'wss://api.minimax.cn/ws/v1/t2a_v2',
    modelId: 'speech-2.8-turbo',
    voice: 'male-qn-qingse',
  },
];

/** Selecting a preset again reuses its profile without overwriting user edits. */
export function applyProviderPreset(settings: Settings, id: string): Settings {
  const preset = providerPresets.find((profile) => profile.id === id);
  if (!preset) throw new Error('服务预设不存在。');
  const existing = settings.profiles.find((profile) => profile.id === id);
  if (existing && existing.stage !== preset.stage)
    throw new Error('配置标识冲突，请检查服务配置。');
  if (!existing && settings.profiles.length >= 30) throw new Error('服务配置数量已达上限。');
  return {
    ...settings,
    profiles: existing ? settings.profiles : [...settings.profiles, { ...preset }],
    active: { ...settings.active, [preset.stage]: preset.id },
  };
}
