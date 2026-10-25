import type { Stage } from './types';

export type ConfigurationSection = 'general' | Stage;

/** Route known configuration notices without guessing a provider from a generic error. */
export function configurationSection(message: string): ConfigurationSection | null {
  if (/完善语音合成服务|语音合成服务.*密钥/.test(message)) return 'tts';
  if (/完善文字翻译服务|文字翻译服务.*密钥/.test(message)) return 'translation';
  if (/完善语音识别服务|语音识别服务.*密钥/.test(message)) return 'asr';
  if (
    /(设备|麦克风)/.test(message) &&
    /(选择|不可用|断开|标识|缺失|找不到|没有默认|请连接)/.test(message)
  )
    return 'general';
  return null;
}
