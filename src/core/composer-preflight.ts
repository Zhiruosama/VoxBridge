import { profileFor, validateProfile } from './settings';
import type { Settings } from './types';

export class ComposerSetupError extends Error {
  constructor(
    message: string,
    public section: 'general' | 'translation' | 'tts',
  ) {
    super(message);
  }
}

/** Before queue acceptance/clearing the draft; no synthesis or translation requests. */
export async function preflightComposer(
  settings: Settings,
  text: string,
  action: 'speak' | 'translate',
  route: Settings['composer']['route'],
  deps: {
    detect: (text: string) => Promise<string | null>;
    output: (id: string) => Promise<unknown>;
  },
) {
  let detection: { language: string | null } | undefined;
  if (!text.trim() || [...text.trim()].length > 2000) throw new Error('请输入 1–2000 字的内容。');
  if (action === 'speak') {
    const invalid = validateProfile(profileFor(settings, 'tts'));
    if (invalid) throw new ComposerSetupError(`${invalid} 请到设置页完善语音合成服务。`, 'tts');
  }
  if (action === 'translate' || settings.composer.output === 'translation') {
    const detected = await deps.detect(text);
    detection = { language: detected };
    if (
      detected !== settings.targetLanguage ||
      (action === 'speak' &&
        settings.composer.contextualSpeech === true &&
        profileFor(settings, 'tts').adapter === 'minimax_tts_ws')
    ) {
      const invalid = validateProfile(profileFor(settings, 'translation'));
      if (invalid)
        throw new ComposerSetupError(`${invalid} 请到设置页完善文字翻译服务。`, 'translation');
    }
  }
  if (action === 'speak') {
    try {
      await deps.output(
        route === 'preview' ? settings.audio.previewDeviceId : settings.audio.sendDeviceId,
      );
      if (route === 'send' && settings.audio.monitorEnabled)
        await deps.output(settings.audio.previewDeviceId);
    } catch (error) {
      throw new ComposerSetupError(String(error).replace(/^Error: /, ''), 'general');
    }
  }
  return detection;
}
