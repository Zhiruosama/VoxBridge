import { blankProfile } from './settings';
import { defaultTranslationPrompt } from './translation-prompt';
import type { ProviderProfile, Settings } from './types';

// Public connection settings only. Credentials are held separately by the OS.
export const providerPresets: ProviderProfile[] = [
  {
    id: 'provider-qwen-realtime',
    name: 'Qwen ASR · 实时',
    stage: 'asr',
    adapter: 'qwen_dashscope_asr',
    baseUrl: 'wss://maas.qianwenaiapi.com/api-ws/v1/inference',
    modelId: 'qwen-audio-3.0-asr-flash-streaming',
    voice: '',
  },
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
    translationPrompt: defaultTranslationPrompt,
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
    id: 'provider-openai-tts',
    name: 'OpenAI 语音',
    stage: 'tts',
    adapter: 'openai_audio_speech',
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-4o-mini-tts',
    voice: 'coral',
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

/** Keep every stage usable without restoring a deleted profile or its credential ID. */
export function removeProviderProfile(
  settings: Settings,
  id: string,
  replacementId: string,
): Settings {
  const removed = settings.profiles.find((p) => p.id === id);
  if (!removed) throw new Error('配置不存在。');
  const profiles = settings.profiles.filter((p) => p.id !== id);
  const active = { ...settings.active };
  if (active[removed.stage] === id) {
    const remaining = profiles.find((p) => p.stage === removed.stage);
    if (remaining) active[removed.stage] = remaining.id;
    else {
      if (replacementId === id || profiles.some((p) => p.id === replacementId))
        throw new Error('空白配置标识重复。');
      profiles.push(blankProfile(removed.stage, replacementId));
      active[removed.stage] = replacementId;
    }
  }
  return { ...settings, profiles, active };
}
