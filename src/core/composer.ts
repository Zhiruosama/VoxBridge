import { profileFor, validateProfile } from './settings';
import type { ComposerSettings, Settings, SpeechProgress } from './types';

export type ComposerPhase =
  | 'idle'
  | 'translating'
  | 'synthesizing'
  | 'decoding'
  | 'playing'
  | 'stopping';
export function composerKeyAction(
  event: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    isComposing: boolean;
    keyCode?: number;
    repeat: boolean;
  },
  action: ComposerSettings['enterAction'],
): 'speak' | 'translate' | 'ignore' | 'newline' {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return 'ignore';
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || action === 'newline')
    return 'newline';
  return event.repeat ? 'ignore' : action;
}

type Dependencies = {
  translate: (
    profile: Settings['profiles'][number],
    text: string,
    source: string,
    target: string,
    id: string,
  ) => Promise<string>;
  speak: (
    profile: Settings['profiles'][number],
    text: string,
    audio: Settings['audio'],
    route: ComposerSettings['route'],
    id: string,
    onProgress: (event: SpeechProgress) => void,
  ) => Promise<void>;
  cancelTranslation: (id: string) => Promise<unknown>;
  stopSpeech: (id: string) => Promise<unknown>;
};

type Operation = { id: string; stage: 'translation' | 'speech'; cancelled: boolean };

export class ComposerController {
  private operation: Operation | null = null;

  constructor(private readonly dependencies: Dependencies) {}

  get busy() {
    return this.operation !== null;
  }

  async run(
    input: {
      id: string;
      text: string;
      settings: Settings;
      action: 'speak' | 'translate';
      route?: ComposerSettings['route'];
      output?: ComposerSettings['output'];
    },
    callbacks: {
      phase: (phase: ComposerPhase) => void;
      translation: (text: string) => void;
    },
  ): Promise<'completed' | 'stopped' | 'busy'> {
    if (this.operation) return 'busy';
    const settings = structuredClone(input.settings);
    const text = input.text.trim();
    const output = input.output ?? settings.composer.output;
    const route = input.route ?? settings.composer.route;
    const needsTranslation = input.action === 'translate' || output === 'translation';
    if (!text || [...text].length > 500) throw new Error('请输入 1–500 字的内容。');
    const translationProfile = profileFor(settings, 'translation');
    const speechProfile = profileFor(settings, 'tts');
    if (needsTranslation) {
      const invalid = validateProfile(translationProfile);
      if (invalid) throw new Error(`${invalid} 请到设置页完善文字翻译服务。`);
    }
    if (input.action === 'speak') {
      const invalid = validateProfile(speechProfile);
      if (invalid) throw new Error(`${invalid} 请到设置页完善语音合成服务。`);
      if (!(route === 'preview' ? settings.audio.previewDeviceId : settings.audio.sendDeviceId))
        throw new Error(`请先在常规设置中选择${route === 'preview' ? '试听' : '发送'}设备。`);
    }
    const operation: Operation = {
      id: input.id,
      stage: needsTranslation ? 'translation' : 'speech',
      cancelled: false,
    };
    this.operation = operation;
    try {
      let content = text;
      if (needsTranslation) {
        callbacks.phase('translating');
        content = await this.dependencies.translate(
          translationProfile,
          text,
          settings.sourceLanguage,
          settings.targetLanguage,
          operation.id,
        );
        if (operation.cancelled) return 'stopped';
        if (!content.trim()) throw new Error('翻译服务返回空内容，请重试。');
        callbacks.translation(content);
      }
      if (operation.cancelled) return 'stopped';
      if (input.action === 'speak') {
        if ([...content].length > 500)
          throw new Error('译文超过 500 字，已保留译文但未输出语音，请缩短内容。');
        operation.stage = 'speech';
        callbacks.phase('synthesizing');
        if (operation.cancelled) return 'stopped';
        await this.dependencies.speak(
          speechProfile,
          content,
          settings.audio,
          route,
          operation.id,
          (event) => {
            if (
              this.operation !== operation ||
              event.requestId !== operation.id ||
              operation.cancelled
            )
              return;
            if (['synthesizing', 'decoding', 'playing'].includes(event.phase))
              callbacks.phase(event.phase as ComposerPhase);
          },
        );
      }
      return operation.cancelled ? 'stopped' : 'completed';
    } catch (error) {
      if (operation.cancelled) return 'stopped';
      throw error;
    } finally {
      if (this.operation === operation) {
        this.operation = null;
        callbacks.phase('idle');
      }
    }
  }

  async cancel(): Promise<void> {
    const operation = this.operation;
    if (!operation || operation.cancelled) return;
    operation.cancelled = true;
    if (operation.stage === 'translation') await this.dependencies.cancelTranslation(operation.id);
    else await this.dependencies.stopSpeech(operation.id);
  }
}
