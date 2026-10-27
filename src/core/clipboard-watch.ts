/** Session-only polling. No clipboard content is persisted or logged. */
export class ClipboardWatcher {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last: string | undefined;
  private own = new Set<string>();
  private oversized = false;
  constructor(
    private dependencies: {
      read: () => Promise<string>;
      onText: (text: string) => void;
      onStatus: (message: string) => void;
    },
  ) {}
  private key(text: string) {
    return `${text.length}:${text.slice(0, 4001)}`;
  }
  ignoreCopy(text: string) {
    this.own.add(this.key(text));
    while (this.own.size > 4) this.own.delete(this.own.keys().next().value!);
  }
  forgetCopy(text: string) {
    this.own.delete(this.key(text));
  }
  start() {
    this.stop();
    this.last = undefined;
    void this.poll(this.generation, true);
  }
  stop() {
    this.generation++;
    clearTimeout(this.timer);
    this.own.clear();
    this.last = undefined;
    this.oversized = false;
  }
  private async poll(generation: number, baseline = false) {
    try {
      const text = await this.dependencies.read();
      if (generation !== this.generation) return;
      if (!this.oversized) this.dependencies.onStatus('');
      const key = this.key(text);
      const changed = key !== this.last;
      this.last = key;
      const owned = this.own.delete(key);
      if (changed) this.oversized = false;
      if (!baseline && changed && !owned && text.trim()) {
        if ([...text].length > 2000) {
          this.oversized = true;
          this.dependencies.onStatus('剪贴板文字超过 2000 字，请手动精简后翻译。');
        } else {
          this.dependencies.onStatus('');
          this.dependencies.onText(text);
        }
      }
    } catch {
      if (generation === this.generation) this.dependencies.onStatus('等待可读取的剪贴板文字…');
    } finally {
      if (generation === this.generation)
        this.timer = setTimeout(() => void this.poll(generation), 500);
    }
  }
}
