export interface AppUpdate {
  version: string;
  download: (
    onEvent: (event: {
      event: string;
      data?: { contentLength?: number; chunkLength?: number };
    }) => void,
  ) => Promise<void>;
  install: () => Promise<void>;
  close: () => Promise<void>;
}

/** A clipboard session is active even before its first copied text arrives. */
export function automaticUpdateBlocker(
  watchingClipboard: boolean,
  ...drafts: string[]
): false | string {
  if (watchingClipboard) return '剪贴板监听正在进行，请停止监听后再自动更新。';
  if (drafts.some((draft) => draft.trim())) return '仍有输入草稿，处理完成后将自动更新。';
  return false;
}
export type UpdateView = {
  startupPrompt: boolean;
  automatic: boolean;
  downloaded: boolean;
  seconds: number | null;
  status:
    | 'idle'
    | 'checking'
    | 'latest'
    | 'available'
    | 'downloading'
    | 'waiting'
    | 'countdown'
    | 'installing'
    | 'error';
  version: string;
  percent: number | null;
  error: string;
};

/** Only install verified packages, and never interrupt a recording, queue or unsaved settings. */
export class AppUpdates {
  private update: AppUpdate | null = null;
  private listeners = new Set<() => void>();
  private startupChecked = false;
  private deferred = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private deadline: number | null = null;
  private state: UpdateView = {
    startupPrompt: false,
    automatic: false,
    downloaded: false,
    seconds: null,
    status: 'idle',
    version: '',
    percent: null,
    error: '',
  };
  blocked: (automatic?: boolean) => boolean | string = () => true;
  beforeInstall: () => void = () => {};
  installFailed: () => void = () => {};
  constructor(
    private checkUpdate: () => Promise<AppUpdate | null>,
    private restart: () => Promise<void>,
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(state: Partial<UpdateView>) {
    this.state = { ...this.state, ...state };
    this.listeners.forEach((listener) => listener());
  }
  setAutomatic(enabled: boolean) {
    if (this.state.automatic === enabled) return;
    this.deferred = false;
    this.emit({ automatic: enabled });
    if (!enabled) {
      this.stopTimer();
      if (['waiting', 'countdown'].includes(this.state.status))
        this.emit({ status: 'available', seconds: null });
    } else if (this.startupChecked) {
      if (this.state.status === 'available') void this.install(true);
      else if (['idle', 'latest', 'error'].includes(this.state.status)) void this.check();
    }
  }
  private stopTimer() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.deadline = null;
  }
  private waitForIdle() {
    this.stopTimer();
    const tick = () => {
      if (!this.state.automatic || this.deferred) {
        this.stopTimer();
        this.emit({ status: 'available', seconds: null });
        return;
      }
      if (this.blocked(true)) {
        this.deadline = null;
        if (this.state.status !== 'waiting') this.emit({ status: 'waiting', seconds: null });
        return;
      }
      this.deadline ??= Date.now() + 5000;
      const seconds = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
      if (this.state.status !== 'countdown' || this.state.seconds !== seconds)
        this.emit({ status: 'countdown', seconds });
      if (seconds === 0) {
        this.stopTimer();
        void this.finishInstall(true);
      }
    };
    this.timer = setInterval(tick, 250);
    tick();
  }
  async checkAtStartup() {
    if (this.startupChecked) return;
    this.startupChecked = true;
    await this.check();
    if (this.state.status === 'available' && this.state.version && !this.deferred)
      this.emit({ startupPrompt: true });
  }
  dismissStartupPrompt() {
    if (['downloading', 'installing'].includes(this.state.status)) return;
    this.deferred = true;
    this.stopTimer();
    if (['waiting', 'countdown'].includes(this.state.status))
      this.emit({ status: 'available', seconds: null });
    this.emit({ startupPrompt: false });
  }
  async check() {
    if (
      ['checking', 'downloading', 'waiting', 'countdown', 'installing'].includes(this.state.status)
    )
      return;
    this.emit({
      status: 'checking',
      error: '',
      ...(this.state.automatic && !this.deferred ? { startupPrompt: true } : {}),
    });
    try {
      const next = await this.checkUpdate();
      await this.update?.close().catch(() => {});
      this.update = next;
      this.emit({
        status: next ? 'available' : 'latest',
        version: next?.version ?? '',
        percent: null,
        downloaded: false,
        seconds: null,
        ...(!next ? { startupPrompt: false } : {}),
      });
      if (next && this.state.automatic && !this.deferred) await this.install(true);
    } catch {
      this.emit({ status: 'error', startupPrompt: false, error: '暂时无法检查更新，请稍后重试。' });
    }
  }
  async install(automatic = false) {
    const update = this.update;
    if (!update || ['checking', 'downloading', 'installing'].includes(this.state.status)) return;
    const blocked = this.blocked(automatic);
    if (!automatic && blocked) {
      this.emit({
        error:
          typeof blocked === 'string'
            ? blocked
            : '请先停止监听和录音、处理发送队列，并保存或放弃设置更改，再更新。',
      });
      return;
    }
    this.stopTimer();
    if (this.state.downloaded) {
      if (automatic) this.waitForIdle();
      else await this.finishInstall(false);
      return;
    }
    this.emit({
      status: 'downloading',
      percent: null,
      error: '',
      ...(automatic ? { startupPrompt: true } : {}),
    });
    let received = 0,
      total = 0;
    try {
      await update.download((event) => {
        if (event.event === 'Started') total = event.data?.contentLength ?? 0;
        if (event.event === 'Progress') received += event.data?.chunkLength ?? 0;
        const percent = total ? Math.min(100, Math.round((received * 100) / total)) : null;
        if (this.state.percent !== percent) this.emit({ percent });
      });
      this.emit({ downloaded: true, percent: 100 });
      if (automatic) {
        if (this.state.automatic && !this.deferred) this.waitForIdle();
        else this.emit({ status: 'available' });
        return;
      }
      // Re-check after download: the user might have started working in another view.
      const blockedAfterDownload = this.blocked();
      if (blockedAfterDownload) {
        this.emit({
          status: 'available',
          error:
            typeof blockedAfterDownload === 'string'
              ? blockedAfterDownload
              : '下载已完成，请先结束当前任务并保存设置，再更新。',
        });
        return;
      }
      await this.finishInstall(false);
    } catch {
      try {
        this.installFailed();
      } catch {
        /* Retain the original failure. */
      }
      this.emit({
        status: 'available',
        error:
          this.state.status === 'installing'
            ? '安装未完成，请使用新版安装包覆盖安装，无需删除原有配置。'
            : '下载或签名校验失败，未安装更新，请重试。',
      });
    }
  }
  private async finishInstall(automatic: boolean) {
    if (!this.update || (automatic && (!this.state.automatic || this.deferred))) return;
    const blocked = this.blocked(automatic);
    if (blocked) {
      if (automatic) this.waitForIdle();
      else
        this.emit({
          status: 'available',
          error:
            typeof blocked === 'string'
              ? blocked
              : '下载已完成，请先结束当前任务并保存设置，再更新。',
        });
      return;
    }
    // Every install path, including cached downloads and automatic countdowns,
    // must snapshot the latest drafts immediately before handing off.
    try {
      this.beforeInstall();
    } catch {
      this.emit({
        status: 'available',
        seconds: null,
        error: '输入内容暂存失败，更新未开始。请复制保存输入内容后重试。',
      });
      return;
    }
    this.emit({ status: 'installing', seconds: null, error: '' });
    try {
      await this.update.install();
      await this.restart();
    } catch {
      try {
        this.installFailed();
      } catch {
        /* Retain the original installation failure. */
      }
      this.emit({
        status: 'available',
        error: '安装未完成，请使用新版安装包覆盖安装，无需删除原有配置。',
      });
    }
  }
}
