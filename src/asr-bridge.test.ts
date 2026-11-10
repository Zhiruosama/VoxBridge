import { expect, it, vi } from 'vitest';
import { defaults } from './core/settings';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, Channel: class {} }));
vi.mock('./diagnostics', () => ({
  diagnosticInvoke: vi.fn(),
  diagnosticListeningProgress: (callback: unknown) => callback,
  diagnosticSpeechProgress: (callback: unknown) => callback,
}));

import { diagnosticInvoke } from './diagnostics';
import { startListening, startVoiceInput, transcribeWav } from './bridge';

it('passes selected languages across IPC for listening, recording and file transcription', async () => {
  const profile = defaults.profiles[0];
  const request = {
    source: { pid: 1, bundleId: 'test' },
    sessionId: 'listen',
    asrProfile: profile,
    translationProfile: defaults.profiles[1],
    sourceLanguage: '日语',
    targetLanguage: '简体中文',
  };
  await startListening(request, () => {});
  expect(diagnosticInvoke).toHaveBeenLastCalledWith(
    'start_listening',
    expect.objectContaining({ request }),
  );
  await startVoiceInput('voice', '', profile, () => {}, '英语');
  expect(diagnosticInvoke).toHaveBeenLastCalledWith(
    'start_voice_input',
    expect.objectContaining({ language: '英语' }),
  );
  await transcribeWav(profile, new Uint8Array(), 'file', '葡萄牙语');
  expect(diagnosticInvoke).toHaveBeenLastCalledWith(
    'transcribe_wav',
    expect.objectContaining({ language: '葡萄牙语' }),
  );
  await startVoiceInput('voice', '', profile, () => {});
  expect(diagnosticInvoke).toHaveBeenLastCalledWith(
    'start_voice_input',
    expect.objectContaining({ language: '自动识别' }),
  );
});
