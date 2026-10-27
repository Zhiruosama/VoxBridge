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
export type UpdateView = {
  startupPrompt: boolean;
  status: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'installing' | 'error';
  version: string;
  percent: number | null;
  error: string;
};

/** Only install verified packages, and never interrupt a recording, queue or unsaved settings. */
export class AppUpdates {
  private update: AppUpdate | null = null;
  private listeners = new Set<() => void>();
  private startupChecked = false;
  private state: UpdateView = {
    startupPrompt: false,
    status: 'idle',
    version: '',
    percent: null,
    error: '',
  };
  blocked = () => true;
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
  async checkAtStartup() {
    if (this.startupChecked) return;
    this.startupChecked = true;
    await this.check();
    if (this.state.status === 'available' && this.state.version) this.emit({ startupPrompt: true });
  }
  dismissStartupPrompt() {
    if (['downloading', 'installing'].includes(this.state.status)) return;
    this.emit({ startupPrompt: false });
  }
  async check() {
    if (['checking', 'downloading', 'installing'].includes(this.state.status)) return;
    this.emit({ status: 'checking', error: '' });
    try {
      const next = await this.checkUpdate();
      await this.update?.close().catch(() => {});
      this.update = next;
      this.emit({
        status: next ? 'available' : 'latest',
        version: next?.version ?? '',
        percent: null,
      });
    } catch {
      this.emit({ status: 'error', error: '暂时无法检查更新，请稍后重试。' });
    }
  }
  async install() {
    const update = this.update;
    if (!update || ['checking', 'downloading', 'installing'].includes(this.state.status)) return;
    if (this.blocked()) {
      this.emit({ error: '请先停止监听和录音、处理发送队列，并保存或放弃设置更改，再更新。' });
      return;
    }
    this.emit({ status: 'downloading', percent: null, error: '' });
    let received = 0,
      total = 0;
    try {
      await update.download((event) => {
        if (event.event === 'Started') total = event.data?.contentLength ?? 0;
        if (event.event === 'Progress') received += event.data?.chunkLength ?? 0;
        this.emit({ percent: total ? Math.min(100, Math.round((received * 100) / total)) : null });
      });
      // Re-check after download: the user might have started working in another view.
      if (this.blocked()) {
        this.emit({
          status: 'available',
          error: '下载已完成，请先结束当前任务并保存设置，再更新。',
        });
        return;
      }
      this.emit({ status: 'installing' });
      await update.install();
      await this.restart();
    } catch {
      this.emit({
        status: 'available',
        error:
          this.state.status === 'installing'
            ? '安装未完成，请使用新版安装包覆盖安装，无需删除原有配置。'
            : '下载或签名校验失败，未安装更新，请重试。',
      });
    }
  }
}
