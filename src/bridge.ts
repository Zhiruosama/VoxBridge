import { invoke, isTauri } from '@tauri-apps/api/core';
import type { OutputDevice, ProviderProfile, RuntimeInfo } from './core/types';

export const desktop = isTauri();
export async function runtimeInfo(): Promise<RuntimeInfo> {
  return desktop
    ? invoke('runtime_info')
    : {
        platform: 'browser',
        nativeCapture: false,
        message: '浏览器预览 · 可体验界面与演示字幕。密钥、真实翻译和音频设备测试请使用桌面版。',
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
