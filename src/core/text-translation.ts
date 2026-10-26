import type { ProviderProfile } from './types';
import { validateProfile } from './settings';

type Dependencies = Pick<typeof import('../bridge'), 'translate' | 'cancelTranslation'>;
export interface TextTranslationState {
  input: string;
  source: string;
  target: string;
  result: string;
  resultTarget: string;
  busy: boolean;
  error: string;
}

/** Session-only text tool; deliberately has no audio or speech dependencies. */
export class TextTranslationController {
  private state: TextTranslationState;
  private listeners = new Set<() => void>();
  private request: string | null = null;
  constructor(
    private dependencies: Dependencies,
    target: string,
  ) {
    this.state = {
      input: '',
      source: '自动识别',
      target,
      result: '',
      resultTarget: '',
      busy: false,
      error: '',
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  update(patch: Partial<Pick<TextTranslationState, 'input' | 'source' | 'target'>>) {
    this.set({ ...patch, error: '' });
  }
  private set(patch: Partial<TextTranslationState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  cancel = () => {
    const request = this.request;
    this.request = null;
    this.set({ busy: false });
    if (request) void this.dependencies.cancelTranslation(request).catch(() => {});
  };
  clear = () => {
    this.cancel();
    this.set({ input: '', result: '', resultTarget: '', error: '' });
  };
  async submit(profile: ProviderProfile) {
    if (this.state.busy) return;
    const { source, target } = this.state;
    const text = this.state.input.trim();
    const invalid = !text
      ? '请输入要翻译的文字。'
      : [...text].length > 2000
        ? '每次最多翻译 2000 个字符。'
        : profile.stage !== 'translation'
          ? '请选择文字翻译服务。'
          : validateProfile(profile);
    if (invalid) {
      this.set({ error: invalid });
      return;
    }
    const request = crypto.randomUUID();
    this.request = request;
    this.set({ busy: true, error: '' });
    try {
      const result =
        source === target
          ? text
          : await this.dependencies.translate(
              structuredClone(profile),
              text,
              source,
              target,
              request,
            );
      if (this.request !== request) return;
      if (!result.trim()) throw new Error('翻译服务未返回有效译文，请重试或更换模型。');
      this.set({ result, resultTarget: target });
    } catch (error) {
      if (this.request === request)
        this.set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (this.request === request) {
        this.request = null;
        this.set({ busy: false });
      }
    }
  }
}
