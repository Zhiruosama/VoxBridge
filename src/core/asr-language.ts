import type { ProviderProfile } from './types';

export const automaticAsrLanguage = '自动识别';
export const asrLanguages = [
  automaticAsrLanguage,
  '简体中文',
  '英语',
  '日语',
  '韩语',
  '西班牙语',
  '印尼语',
  '粤语',
  '芬兰语',
  '俄语',
  '德语',
  '法语',
  '葡萄牙语',
  '意大利语',
  '越南语',
  '泰语',
  '阿拉伯语',
  '印地语',
];

export function parseAsrLanguage(value: unknown): string {
  return typeof value === 'string' && asrLanguages.includes(value) ? value : automaticAsrLanguage;
}

export function asrLanguageHint(profile: ProviderProfile, language: string): string {
  if (language !== automaticAsrLanguage && profile.adapter === 'qwen_dashscope_asr') {
    if (
      !['qwen-audio-3.0-asr-flash-streaming', 'qwen-audio-3.1-asr-flash-streaming'].includes(
        profile.modelId,
      )
    )
      return '当前自定义实时模型尚未适配语言提示，将使用自动识别。';
    if (language === '粤语')
      return profile.modelId === 'qwen-audio-3.1-asr-flash-streaming'
        ? '当前模型仅启用保留方言表达，不会限定为粤语。'
        : '当前实时模型不支持限定粤语；可改用千问 HTTP 短音频模型。';
  }
  return '选择音频实际使用的语言可减少误判；混合多种语言时请选择自动识别。';
}
