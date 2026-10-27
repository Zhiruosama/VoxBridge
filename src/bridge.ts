import { Channel, isTauri } from '@tauri-apps/api/core';
import {
  diagnosticInvoke as invoke,
  diagnosticSpeechProgress,
  diagnosticListeningProgress,
} from './diagnostics';
import type {
  AudioRouting,
  CaptureProgress,
  CaptureSource,
  ListeningEvent,
  OutputDevice,
  VirtualMicStatus,
  OverlaySnapshot,
  ProviderProfile,
  RuntimeInfo,
  SpeechProgress,
  Transcript,
} from './core/types';

export const desktop = isTauri();
export async function setMainCloseBehavior(behavior: 'hide' | 'quit'): Promise<void> {
  if (desktop) await invoke('set_main_close_behavior', { behavior });
}
export async function microphoneAccess(): Promise<string> {
  return desktop ? invoke('microphone_access') : 'not-applicable';
}
export async function openAudioSettings(page: 'microphone' | 'devices'): Promise<void> {
  if (desktop) await invoke('open_audio_settings', { page });
}
export async function detectTextLanguage(text: string): Promise<string | null> {
  return desktop ? invoke('detect_text_language', { text }) : null;
}
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
  profile: ProviderProfile & { language?: string },
  text: string,
  routing: AudioRouting,
  route: 'preview' | 'send',
  requestId: string,
  onProgress: (event: SpeechProgress) => void,
): Promise<void> {
  if (!desktop) throw new Error('语音合成与设备输出需要桌面版。');
  const channel = new Channel<SpeechProgress>();
  channel.onmessage = diagnosticSpeechProgress('speak', requestId, onProgress);
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
export async function finishListening(sessionId: string) {
  if (desktop) await invoke('finish_listening', { sessionId });
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
  channel.onmessage = diagnosticListeningProgress(onEvent);
  return invoke('start_listening', { request, onEvent: channel });
}
export async function publishOverlay(snapshot: OverlaySnapshot): Promise<void> {
  if (desktop) await invoke('publish_overlay', { snapshot });
}
export async function readOverlay(): Promise<OverlaySnapshot> {
  return invoke('read_overlay');
}
export async function showOverlay(): Promise<void> {
  if (!desktop) throw new Error('悬浮字幕需要桌面应用。');
  await invoke('show_overlay');
}
export async function hideOverlay(): Promise<void> {
  await invoke('hide_overlay');
}
export async function focusMain(): Promise<void> {
  await invoke('focus_main');
}
export async function stopOverlayListening(): Promise<void> {
  await invoke('stop_overlay_listening');
}

export async function setSpeechMonitoring(requestId: string, enabled: boolean) {
  if (desktop) await invoke('set_speech_monitoring', { requestId, enabled });
}
export async function openVirtualMicInstaller() {
  if (!desktop) throw new Error('安装虚拟麦克风需要桌面版。');
  await invoke('open_virtual_mic_installer');
}
export async function virtualMicStatus(): Promise<VirtualMicStatus> {
  return desktop
    ? invoke('virtual_mic_status')
    : { provider: 'unsupported', output: null, inputName: null, partial: false };
}
export async function openVirtualMicVendor() {
  if (desktop) await invoke('open_virtual_mic_vendor');
}

export interface VoiceProgress {
  phase: 'recording' | 'recognizing';
  seconds: number;
  level: number;
}
export async function listInputs(): Promise<OutputDevice[]> {
  return desktop ? invoke('list_inputs') : [];
}
export async function startVoiceInput(
  requestId: string,
  deviceId: string,
  profile: ProviderProfile,
  onProgress: (progress: VoiceProgress) => void,
): Promise<Transcript> {
  if (!desktop) throw new Error('麦克风录音需要桌面版。');
  const channel = new Channel<VoiceProgress>();
  channel.onmessage = onProgress;
  return invoke('start_voice_input', { requestId, deviceId, profile, onProgress: channel });
}
export async function finishVoiceInput(requestId: string) {
  await invoke('finish_voice_input', { requestId });
}
export async function cancelVoiceInput(requestId: string) {
  await invoke('cancel_voice_input', { requestId });
}

export type OverlayResizeDirection =
  | 'North'
  | 'South'
  | 'East'
  | 'West'
  | 'NorthEast'
  | 'NorthWest'
  | 'SouthEast'
  | 'SouthWest';
export async function resizeOverlay(
  id: string,
  phase: 'begin' | 'move' | 'end',
  direction: OverlayResizeDirection,
): Promise<void> {
  await invoke('resize_overlay', { id, phase, direction });
}

export async function dragOverlay(
  id: string,
  phase: 'begin' | 'move' | 'end',
  x = 0,
  y = 0,
): Promise<void> {
  await invoke('drag_overlay', { id, phase, x, y });
}

export async function publishOverlayVoice(
  state: import('./core/types').OverlayVoiceState,
): Promise<void> {
  if (desktop) await invoke('publish_overlay_voice', { state });
}
export async function readOverlayVoice(): Promise<import('./core/types').OverlayVoiceState> {
  return invoke('read_overlay_voice');
}
export async function overlayVoiceAction(
  request: import('./core/types').OverlayVoiceRequest,
): Promise<void> {
  return invoke('overlay_voice_action', { request });
}

export async function prepareSpeech(
  profile: ProviderProfile & { language?: string },
  text: string,
  requestId: string,
): Promise<void> {
  return invoke('prepare_speech', { profile, text, requestId });
}
export async function playPreparedSpeech(
  routing: AudioRouting,
  route: 'preview' | 'send',
  requestId: string,
  onProgress: (event: SpeechProgress) => void,
): Promise<void> {
  const channel = new Channel<SpeechProgress>();
  channel.onmessage = diagnosticSpeechProgress('play_prepared_speech', requestId, onProgress);
  return invoke('play_prepared_speech', { routing, route, requestId, onProgress: channel });
}
export async function discardPreparedSpeech(requestId: string): Promise<void> {
  return invoke('discard_prepared_speech', { requestId });
}
