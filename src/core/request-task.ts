/** Local completion never depends on the backend acknowledging cancellation. */
export class RequestTask {
  private reject: ((error: Error) => void) | null = null;
  private ended = false;
  constructor(private stop: () => Promise<unknown>) {}
  get active() {
    return !this.ended;
  }
  cancel() {
    if (this.ended) return;
    this.ended = true;
    this.reject?.(new Error('操作已取消。'));
    void this.stop().catch(() => {});
  }
  async run<T>(action: () => Promise<T>, milliseconds = 45000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      this.reject = reject;
      timer = setTimeout(() => {
        this.ended = true;
        reject(new Error('服务响应超时，内容已保留，请重试。'));
        void this.stop().catch(() => {});
      }, milliseconds);
    });
    try {
      return await Promise.race([action(), interrupted]);
    } finally {
      clearTimeout(timer);
      this.ended = true;
      this.reject = null;
    }
  }
}
