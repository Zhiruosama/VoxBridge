import type { ProviderProfile } from './types';

export const emotions = {
  auto: '自动',
  calm: '平静',
  happy: '高兴',
  sad: '悲伤',
  angry: '愤怒',
  fearful: '害怕',
  disgusted: '厌恶',
  surprised: '惊讶',
  fluent: '生动',
  whisper: '低语',
} as const;
export const soundEffects = {
  none: '无',
  spacious_echo: '空旷回音',
  auditorium_echo: '礼堂广播',
  lofi_telephone: '电话效果',
  robotic: '电音',
} as const;
export interface SpeechOptions {
  emotion: keyof typeof emotions;
  volume: number;
  pitch: number;
  effectPitch: number;
  intensity: number;
  timbre: number;
  soundEffect: keyof typeof soundEffects;
  pronunciation: string[];
}
export const speechOptionDefaults: SpeechOptions = {
  emotion: 'auto',
  volume: 1,
  pitch: 0,
  effectPitch: 0,
  intensity: 0,
  timbre: 0,
  soundEffect: 'none',
  pronunciation: [],
};
export function supportsEmotion(model: string, emotion: string) {
  if (emotion === 'auto') return true;
  if (emotion === 'whisper' || emotion === 'fluent') return /^speech-2\.6-(hd|turbo)$/.test(model);
  return /^speech-(2\.[68]|02|01)-(hd|turbo)$/.test(model);
}
export function emotionOptions(model: string) {
  return Object.entries(emotions)
    .filter(([value]) => supportsEmotion(model, value))
    .map(([value, label]) => ({ value, label }));
}
export function speechOptions(profile: ProviderProfile): SpeechOptions {
  return profile.speechOptions ?? speechOptionDefaults;
}
export function parseSpeechOptions(value: unknown): SpeechOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('语音参数格式无效。');
  const raw = value as Record<string, unknown>;
  const result = { ...speechOptionDefaults, ...raw };
  for (const [key, min, max, integer] of [
    ['volume', 0.1, 10, false],
    ['pitch', -12, 12, true],
    ['effectPitch', -100, 100, true],
    ['intensity', -100, 100, true],
    ['timbre', -100, 100, true],
  ] as const) {
    const n = result[key];
    if (
      typeof n !== 'number' ||
      !Number.isFinite(n) ||
      n < min ||
      n > max ||
      (integer && !Number.isInteger(n))
    )
      throw new Error('语音参数超出允许范围。');
  }
  if (!Object.hasOwn(emotions, result.emotion) || !Object.hasOwn(soundEffects, result.soundEffect))
    throw new Error('不支持的语音情绪或音效。');
  if (Array.isArray(result.pronunciation))
    result.pronunciation = result.pronunciation
      .filter((line) => typeof line !== 'string' || line.trim() !== '')
      .map((line) => (typeof line === 'string' ? line.trim() : line));
  if (
    !Array.isArray(result.pronunciation) ||
    result.pronunciation.length > 50 ||
    result.pronunciation.some(
      (line) =>
        typeof line !== 'string' ||
        !line.includes('/') ||
        !line.split('/')[0].trim() ||
        !line.slice(line.indexOf('/') + 1).trim() ||
        new TextEncoder().encode(line).length > 300 ||
        /[\u0000-\u001f\u007f]/.test(line),
    )
  )
    throw new Error('发音替换最多 50 行，每行使用“原词/读法”，且不超过 300 字节。');
  return {
    emotion: result.emotion,
    volume: result.volume,
    pitch: result.pitch,
    effectPitch: result.effectPitch,
    intensity: result.intensity,
    timbre: result.timbre,
    soundEffect: result.soundEffect,
    pronunciation: [...result.pronunciation],
  };
}
