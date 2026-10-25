import type { ProviderProfile, Settings } from './types';
import { profileFor } from './settings';

export interface SpeechOption {
  value: string;
  label: string;
  group?: string;
  translate?: boolean;
}

/** Catalogs belong to a protocol/provider; an OpenAI-compatible endpoint need not be OpenAI. */
export function speechProvider(profile: ProviderProfile): string {
  if (profile.adapter === 'minimax_tts_ws') return 'MiniMax';
  if (profile.adapter === 'qwen_chat_asr' || profile.adapter === 'qwen_dashscope_asr')
    return '阿里云 · Qwen';
  try {
    if (profile.stage === 'translation' && new URL(profile.baseUrl).hostname === 'api.deepseek.com')
      return 'DeepSeek';
    if (
      profile.adapter === 'openai_audio_speech' &&
      new URL(profile.baseUrl).hostname === 'api.openai.com'
    )
      return 'OpenAI';
  } catch {
    /* Empty/custom endpoints retain their own IDs. */
  }
  return '自定义服务';
}

export function modelOptions(profile: ProviderProfile): SpeechOption[] {
  const provider = speechProvider(profile);
  const ids =
    profile.stage === 'tts' && provider === 'MiniMax'
      ? ['speech-2.8-turbo', 'speech-2.8-hd']
      : profile.adapter === 'qwen_dashscope_asr'
        ? ['qwen-audio-3.0-asr-flash-streaming']
        : profile.adapter === 'qwen_chat_asr'
          ? ['qwen3-asr-flash']
          : provider === 'OpenAI'
            ? ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']
            : [];
  return withCurrent(
    mergePresets(
      profile,
      'modelPresets',
      ids.map((value) => ({ value, label: value, group: provider })),
    ),
    profile.modelId,
  );
}

// Curated IDs from the providers' public catalogs; custom/cloned IDs are never discarded.
const minimaxVoices: [string, string, string][] = [
  ['male-qn-qingse', '青涩青年', '中文'],
  ['male-qn-daxuesheng', '青年大学生', '中文'],
  ['female-shaonv', '少女', '中文'],
  ['female-yujie', '御姐', '中文'],
  ['female-chengshu', '成熟女性', '中文'],
  ['female-tianmei', '甜美女性', '中文'],
  ['Cantonese_GentleLady', '温柔女声', '粤语'],
  ['Cantonese_PlayfulMan', '活泼男声', '粤语'],
  ['Cantonese_CuteGirl', '可爱女孩', '粤语'],
  ['Cantonese_KindWoman', '善良女声', '粤语'],
  ['English_Trustworth_Man', '可靠男声', '英语'],
  ['English_CalmWoman', '平静女声', '英语'],
  ['English_radiant_girl', '活力女孩', '英语'],
  ['English_Gentle-voiced_man', '温柔男声', '英语'],
  ['Japanese_GentleButler', '温柔管家', '日语'],
  ['Japanese_CalmLady', '平静女士', '日语'],
  ['Korean_CalmGentleman', '沉稳男声', '韩语'],
  ['Korean_CalmLady', '平静女声', '韩语'],
  ['Spanish_SereneWoman', '宁静女声', '西班牙语'],
  ['Spanish_ThoughtfulMan', '体贴男声', '西班牙语'],
];

export function voiceOptions(profile: ProviderProfile): SpeechOption[] {
  const provider = speechProvider(profile);
  let options: SpeechOption[] = [];
  if (provider === 'MiniMax')
    options = minimaxVoices.map(([value, label, language]) => ({
      value,
      label,
      group: `MiniMax · ${language}`,
    }));
  else if (provider === 'OpenAI') {
    const common = ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'];
    const ids = profile.modelId.startsWith('gpt-4o-mini-tts')
      ? [...common, 'ballad', 'verse', 'marin', 'cedar']
      : common;
    options = ids.map((value) => ({ value, label: value, group: 'OpenAI' }));
  }
  return withCurrent(mergePresets(profile, 'voicePresets', options), profile.voice);
}

function mergePresets(
  profile: ProviderProfile,
  kind: 'modelPresets' | 'voicePresets',
  builtins: SpeechOption[],
): SpeechOption[] {
  const custom = (profile[kind] ?? []).filter((item) => item.adapter === profile.adapter);
  return [
    ...custom.map((item) => ({
      value: item.value,
      label: item.name,
      translate: false,
      group: '我的预设',
    })),
    ...builtins.filter((item) => !custom.some((preset) => preset.value === item.value)),
  ];
}

function withCurrent(options: SpeechOption[], current: string): SpeechOption[] {
  return current && !options.some((option) => option.value === current)
    ? [{ value: current, label: current, translate: false, group: '当前自定义' }, ...options]
    : options;
}

/** Updating a voice/model must retain the credential identity and all unrelated settings. */
export function updateSpeechProfile(
  settings: Settings,
  change: Partial<Pick<ProviderProfile, 'voice' | 'modelId' | 'speed'>>,
): Settings {
  const profile = profileFor(settings, 'tts');
  const modelChange = change.modelId ? speechModelChange(profile, change.modelId) : {};
  return {
    ...settings,
    profiles: settings.profiles.map((p) =>
      p.id === profile.id ? { ...p, ...modelChange, ...change } : p,
    ),
  };
}

/** Known newer voices cannot be used with the legacy OpenAI models. Keep user-defined IDs. */
export function speechModelChange(
  profile: ProviderProfile,
  modelId: string,
): Partial<ProviderProfile> {
  return {
    modelId,
    ...(speechProvider(profile) === 'OpenAI' &&
    ['tts-1', 'tts-1-hd'].includes(modelId) &&
    ['ballad', 'verse', 'marin', 'cedar'].includes(profile.voice)
      ? { voice: 'alloy' }
      : {}),
  };
}
