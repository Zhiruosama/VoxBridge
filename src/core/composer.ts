import { profileFor, validateProfile } from './settings';
import type { ComposerSettings, Settings, SpeechProgress } from './types';

export type ComposerPhase =
  | 'idle'
  | 'detecting'
  | 'waitingDevice'
  | 'translating'
  | 'synthesizing'
  | 'decoding'
  | 'playing'
  | 'stopping';
export function composerLanguages(settings: Settings, _listening: boolean) {
  return { source: settings.sourceLanguage, target: settings.targetLanguage };
}

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
  detectLanguage?: (text: string) => Promise<string | null>;
  translate: (
    profile: Settings['profiles'][number],
    text: string,
    source: string,
    target: string,
    id: string,
  ) => Promise<string>;
  speak: (
    profile: Settings['profiles'][number] & { language?: string },
    text: string,
    audio: Settings['audio'],
    route: ComposerSettings['route'],
    id: string,
    onProgress: (event: SpeechProgress) => void,
  ) => Promise<void>;
  setMonitoring?: (id: string, enabled: boolean) => Promise<unknown>;
  cancelTranslation: (id: string) => Promise<unknown>;
  stopSpeech: (id: string) => Promise<unknown>;
};

type Operation = {
  id: string;
  stage: 'translation' | 'speech';
  cancelled: boolean;
  monitorEnabled: boolean;
};

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
      listening?: boolean;
      route?: ComposerSettings['route'];
      output?: ComposerSettings['output'];
    },
    callbacks: {
      accepted?: () => void;
      phase: (phase: ComposerPhase) => void;
      translation: (text: string) => void;
      notice?: (message: string) => void;
    },
  ): Promise<'completed' | 'stopped' | 'busy'> {
    if (this.operation) return 'busy';
    const settings = structuredClone(input.settings);
    const direction = composerLanguages(settings, input.listening ?? false);
    const text = input.text.trim();
    const output = input.output ?? settings.composer.output;
    const route = input.route ?? settings.composer.route;
    const needsTranslation = input.action === 'translate' || output === 'translation';
    if (!text || [...text].length > 2000) throw new Error('请输入 1–2000 字的内容。');
    const translationProfile = profileFor(settings, 'translation');
    const speechProfile = profileFor(settings, 'tts');
    if (input.action === 'speak') {
      const invalid = validateProfile(speechProfile);
      if (invalid) throw new Error(`${invalid} 请到设置页完善语音合成服务。`);
      if (!(route === 'preview' ? settings.audio.previewDeviceId : settings.audio.sendDeviceId))
        throw new Error(`请先在常规设置中选择${route === 'preview' ? '试听' : '发送'}设备。`);
    }
    if (
      input.action === 'speak' &&
      route === 'send' &&
      settings.audio.monitorEnabled &&
      !settings.audio.previewDeviceId
    )
      throw new Error('请先选择试听设备，或关闭发送时试听。');
    const operation: Operation = {
      id: input.id,
      stage: needsTranslation ? 'translation' : 'speech',
      cancelled: false,
      monitorEnabled: settings.audio.monitorEnabled === true,
    };
    this.operation = operation;
    try {
      callbacks.accepted?.();
      let content = text;
      let detected: string | null = null;
      if (this.dependencies.detectLanguage) {
        callbacks.phase('detecting');
        detected = await this.dependencies.detectLanguage(text);
        if (operation.cancelled) return 'stopped';
      }
      if (needsTranslation) {
        if (detected !== direction.target) {
          const invalid = validateProfile(translationProfile);
          if (invalid) throw new Error(`${invalid} 请到设置页完善文字翻译服务。`);
          callbacks.phase('translating');
          content = await this.dependencies.translate(
            translationProfile,
            text,
            direction.source,
            direction.target,
            operation.id,
          );
          if (operation.cancelled) return 'stopped';
          if (!content.trim()) throw new Error('翻译服务返回空内容，请重试。');
        }
        callbacks.translation(content);
      }
      if (operation.cancelled) return 'stopped';
      if (input.action === 'speak') {
        if ([...content].length > 2000)
          throw new Error('译文超过 2000 字，已保留译文但未输出语音，请缩短内容。');
        operation.stage = 'speech';
        callbacks.phase('synthesizing');
        if (operation.cancelled) return 'stopped';
        await this.dependencies.speak(
          {
            ...speechProfile,
            language: needsTranslation ? direction.target : (detected ?? undefined),
          },
          content,
          { ...settings.audio, monitorEnabled: operation.monitorEnabled },
          route,
          operation.id,
          (event) => {
            if (
              this.operation !== operation ||
              event.requestId !== operation.id ||
              operation.cancelled
            )
              return;
            if (event.phase === 'monitorUnavailable') {
              callbacks.notice?.('本地试听不可用，语音发送继续。');
              return;
            }
            if (['waitingDevice', 'synthesizing', 'decoding', 'playing'].includes(event.phase))
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

  async setMonitoring(enabled: boolean): Promise<void> {
    const operation = this.operation;
    if (!operation || operation.cancelled) return;
    operation.monitorEnabled = enabled;
    if (operation.stage === 'speech')
      await this.dependencies.setMonitoring?.(operation.id, enabled);
  }

  async cancel(): Promise<void> {
    const operation = this.operation;
    if (!operation || operation.cancelled) return;
    operation.cancelled = true;
    if (operation.stage === 'translation') await this.dependencies.cancelTranslation(operation.id);
    else await this.dependencies.stopSpeech(operation.id);
  }
}
