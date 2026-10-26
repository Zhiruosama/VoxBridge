import { recordDiagnostic } from '../diagnostics';
import { errorKind } from './diagnostics';
import { RequestTask } from './request-task';
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
  canRetry: boolean;
  startedAt: number;
}

/** Session-only text tool; deliberately has no audio or speech dependencies. */
export class TextTranslationController {
  private state: TextTranslationState;
  private listeners = new Set<() => void>();
  private request: string | null = null;
  private task: RequestTask | null = null;
  private failed: Pick<TextTranslationState, 'input' | 'source' | 'target'> | null = null;
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
      canRetry: false,
      startedAt: 0,
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
    this.set(patch);
  }
  private set(patch: Partial<TextTranslationState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  cancel = () => {
    this.request = null;
    this.task?.cancel();
    this.task = null;
    this.set({ busy: false, startedAt: 0 });
  };
  clear = () => {
    this.cancel();
    this.failed = null;
    this.set({ input: '', result: '', resultTarget: '', error: '', canRetry: false });
  };
  retry(profile: ProviderProfile) {
    if (this.failed) return this.submit(profile, this.failed);
  }
  async submit(
    profile: ProviderProfile,
    previous?: Pick<TextTranslationState, 'input' | 'source' | 'target'>,
  ) {
    if (this.state.busy) return;
    const snapshot = previous ?? this.state;
    const { source, target } = snapshot;
    const text = snapshot.input.trim();
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
    const task = new RequestTask(() => this.dependencies.cancelTranslation(request));
    this.task = task;
    this.set({ busy: true, error: '', canRetry: false, startedAt: Date.now() });
    try {
      const result =
        source === target
          ? text
          : await task.run(() =>
              this.dependencies.translate(structuredClone(profile), text, source, target, request),
            );
      if (this.request !== request) return;
      if (!result.trim()) throw new Error('翻译服务未返回有效译文，请重试或更换模型。');
      this.failed = null;
      this.set({ result, resultTarget: target, canRetry: false });
    } catch (error) {
      if (this.request === request) {
        recordDiagnostic({ operation: 'frontend', kind: 'error', reason: errorKind(error) });
        this.failed = { input: text, source, target };
        this.set({ error: error instanceof Error ? error.message : String(error), canRetry: true });
      }
    } finally {
      if (this.request === request) {
        this.request = null;
        this.task = null;
        this.set({ busy: false, startedAt: 0 });
      }
    }
  }
}

/** Safari can report the IME-confirming Enter with keyCode 229 after composition ends. */
export function textTranslationSubmitKey(event: {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  keyCode?: number;
}): boolean {
  return (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.altKey &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}
