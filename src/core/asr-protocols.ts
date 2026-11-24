import type { Adapter, ProviderProfile } from './types';

export const doubaoRealtimeUrl = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
export const doubaoResourceIds = ['volc.seedasr.sauc.duration', 'volc.seedasr.sauc.concurrent'];

export function isRealtimeAsr(adapter: Adapter): boolean {
  return adapter === 'qwen_dashscope_asr' || adapter === 'doubao_realtime_asr';
}

export function canTranscribeWav(adapter: Adapter): boolean {
  return ['qwen_chat_asr', 'openai_audio_transcriptions', 'doubao_realtime_asr'].includes(adapter);
}

export function supportsSpeakerLabels(
  profile: Pick<ProviderProfile, 'stage' | 'adapter' | 'modelId'>,
): boolean {
  return (
    profile.stage === 'asr' &&
    profile.adapter === 'doubao_realtime_asr' &&
    doubaoResourceIds.includes(profile.modelId.trim())
  );
}
