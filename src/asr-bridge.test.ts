import { expect, it, vi } from 'vitest';
import { defaults } from './core/settings';
import { builtinTranslationPromptPresets } from './core/translation-prompt';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, Channel: class {} }));
vi.mock('./diagnostics', () => ({
  diagnosticInvoke: vi.fn(),
  diagnosticListeningProgress: (callback: unknown) => callback,
  diagnosticSpeechProgress: (callback: unknown) => callback,
}));

import { diagnosticInvoke } from './diagnostics';
import { startListening, startVoiceInput, transcribeWav, translate } from './bridge';

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

it('uses the selected prompt for both listening subtitles and typed translation', async () => {
  const math = builtinTranslationPromptPresets.find((preset) => preset.name === '数学')!;
  const profile = { ...defaults.profiles[1], translationPrompt: math.prompt };
  await startListening(
    {
      source: { pid: 1, bundleId: 'test' },
      sessionId: 'listen',
      asrProfile: defaults.profiles[0],
      translationProfile: profile,
      sourceLanguage: '英语',
      targetLanguage: '简体中文',
    },
    () => {},
  );
  expect(diagnosticInvoke).toHaveBeenLastCalledWith(
    'start_listening',
    expect.objectContaining({ request: expect.objectContaining({ translationProfile: profile }) }),
  );
  await translate(profile, '左逆', '简体中文', '英语', 'typed');
  expect(diagnosticInvoke).toHaveBeenLastCalledWith('translate', {
    profile,
    text: '左逆',
    source: '简体中文',
    target: '英语',
    requestId: 'typed',
  });
  await translate(profile, '左逆', '简体中文', '英语', 'text', 'text-tool');
  expect(diagnosticInvoke).toHaveBeenLastCalledWith(
    'translate',
    expect.objectContaining({ profile, textTool: true }),
  );
});
