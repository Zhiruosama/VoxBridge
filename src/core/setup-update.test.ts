import { expect, it, vi } from 'vitest';
import { SetupUpdateTask } from './setup-update';

it('StrictMode remounts share one update installation', async () => {
  const execute = vi.fn(async () => ({ restarted: true }));
  const task = new SetupUpdateTask(execute);
  const first = task.run();
  expect(task.run()).toBe(first);
  await Promise.all([first, task.run()]);
  expect(execute).toHaveBeenCalledOnce();
});
it('only an explicit retry reruns a failed update and overlapping retries share the job', async () => {
  const execute = vi
    .fn()
    .mockRejectedValueOnce(Error('busy'))
    .mockResolvedValue({ restarted: true });
  const task = new SetupUpdateTask(execute);
  const failed = task.run();
  await expect(failed).rejects.toThrow('busy');
  expect(task.run()).toBe(failed);
  const retry = task.retry();
  expect(task.retry()).toBe(retry);
  await retry;
  expect(execute).toHaveBeenCalledTimes(2);
});
