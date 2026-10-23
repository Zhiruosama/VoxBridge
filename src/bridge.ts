import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import type {
  AudioRouting,
  CaptureProgress,
  CaptureSource,
  ListeningEvent,
  OutputDevice,
  ProviderProfile,
  RuntimeInfo,
  SpeechProgress,
  Transcript,
} from './core/types';

export const desktop = isTauri();
export async function runtimeInfo(): Promise<RuntimeInfo> {
  return desktop
    ? invoke('runtime_info')
    : {
        platform: 'browser',
        nativeCapture: false,
        message: '浏览器预览 · 可检查界面与非敏感配置。密钥、真实翻译和音频设备测试请使用桌面版。',
      };
}
export async function credentialStatus(id: string): Promise<boolean> {
  return desktop ? invoke('credential_status', { id }) : false;
}
export async function setCredential(id: string, secret: string): Promise<void> {
  if (!desktop) throw new Error('请在桌面版保存密钥，浏览器不会持久化 API Key。');
  return invoke('set_credential', { id, secret });
}
export async function removeCredential(id: string): Promise<void> {
  if (desktop) return invoke('remove_credential', { id });
}
export async function translate(
  profile: ProviderProfile,
  text: string,
  source: string,
  target: string,
  requestId: string,
): Promise<string> {
  if (!desktop) throw new Error('真实翻译需要桌面版，密钥和请求由本机后端处理。');
  return invoke('translate', { profile, text, source, target, requestId });
}
export async function cancelTranslation(requestId: string) {
  if (desktop) await invoke('cancel_translation', { requestId });
}
export async function listOutputs(): Promise<OutputDevice[]> {
  return desktop ? invoke('list_outputs') : [];
}
export async function testTone(deviceId: string) {
  if (!desktop) throw new Error('音频设备测试需要桌面版。');
  return invoke('test_tone', { deviceId });
}
export async function stopTone() {
  if (desktop) await invoke('stop_tone');
}
export async function speak(
  profile: ProviderProfile,
  text: string,
  routing: AudioRouting,
  route: 'preview' | 'send',
  requestId: string,
  onProgress: (event: SpeechProgress) => void,
): Promise<void> {
  if (!desktop) throw new Error('语音合成与设备输出需要桌面版。');
  const channel = new Channel<SpeechProgress>();
  channel.onmessage = onProgress;
  return invoke('speak', { profile, text, routing, route, requestId, onProgress: channel });
}
export async function stopSpeech(requestId: string) {
  if (desktop) await invoke('stop_speech', { requestId });
}
export async function listCaptureSources(): Promise<CaptureSource[]> {
  return desktop ? invoke('list_capture_sources') : [];
}
export async function captureDiagnostic(
  source: CaptureSource,
  sessionId: string,
  onProgress: (event: CaptureProgress) => void,
): Promise<void> {
  if (!desktop) throw new Error('应用声音采集诊断需要 Mac 桌面版。');
  const channel = new Channel<CaptureProgress>();
  channel.onmessage = onProgress;
  return invoke('capture_diagnostic', { source, sessionId, onProgress: channel });
}
export async function stopCapture(sessionId: string) {
  if (desktop) await invoke('stop_capture', { sessionId });
}
export async function transcribeWav(
  profile: ProviderProfile,
  audio: Uint8Array,
  requestId: string,
): Promise<Transcript> {
  if (!desktop) throw new Error('ASR 音频转写需要桌面版。');
  return invoke('transcribe_wav', { profile, audio: Array.from(audio), requestId });
}
export async function stopAsr(requestId: string) {
  if (desktop) await invoke('stop_asr', { requestId });
}
export async function startListening(
  request: {
    source: CaptureSource;
    sessionId: string;
    asrProfile: ProviderProfile;
    translationProfile: ProviderProfile;
    sourceLanguage: string;
    targetLanguage: string;
  },
  onEvent: (event: ListeningEvent) => void,
): Promise<void> {
  if (!desktop) throw new Error('分段监听需要 Mac 桌面版。');
  const channel = new Channel<ListeningEvent>();
  channel.onmessage = onEvent;
  return invoke('start_listening', { request, onEvent: channel });
}
