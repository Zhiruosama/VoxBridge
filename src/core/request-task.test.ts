import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestTask } from './request-task';

afterEach(() => vi.useRealTimers());
describe('bounded cancellable requests', () => {
  it('returns immediately on cancel even when native cancellation never acknowledges', async () => {
    const stop = vi.fn(() => new Promise(() => {}));
    const task = new RequestTask(stop);
    const request = task.run(() => new Promise(() => {}));
    const rejected = expect(request).rejects.toThrow('取消');
    task.cancel();
    await rejected;
    expect(stop).toHaveBeenCalledTimes(1);
    task.cancel();
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it('times out and cleans its timer without waiting for an unresponsive service', async () => {
    vi.useFakeTimers();
    const stop = vi.fn(async () => {});
    const task = new RequestTask(stop);
    const request = task.run(() => new Promise(() => {}), 100);
    const rejected = expect(request).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not cancel a completed request or retain deadline timers', async () => {
    vi.useFakeTimers();
    const stop = vi.fn(async () => {});
    const task = new RequestTask(stop);
    expect(await task.run(async () => 'ok')).toBe('ok');
    task.cancel();
    expect(stop).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
