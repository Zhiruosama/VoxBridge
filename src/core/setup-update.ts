/** StrictMode remounts share one install attempt. Only an explicit retry starts another. */
export class SetupUpdateTask<T> {
  private task: Promise<T> | undefined;
  private pending = false;
  constructor(private execute: () => Promise<T>) {}
  run() {
    if (!this.task) {
      this.pending = true;
      this.task = Promise.resolve()
        .then(() => this.execute())
        .finally(() => {
          this.pending = false;
        });
    }
    return this.task;
  }
  retry() {
    if (!this.pending) this.task = undefined;
    return this.run();
  }
}
