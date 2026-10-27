import { afterEach, expect, it, vi } from 'vitest';
import { AppUpdates } from './app-update';
afterEach(() => vi.useRealTimers());

function fixture() {
  const update = {
    version: '0.3.0',
    download: vi.fn(async (_event: unknown) => {}),
    install: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const check = vi.fn(async () => update);
  const restart = vi.fn(async () => {});
  const controller = new AppUpdates(check, restart);
  controller.blocked = () => false;
  return { controller, check, update, restart };
}
it('checks once during overlapping checks and releases the previous native resource', async () => {
  const f = fixture();
  await Promise.all([f.controller.check(), f.controller.check()]);
  expect(f.check).toHaveBeenCalledTimes(1);
  expect(f.controller.snapshot().version).toBe('0.3.0');
  await f.controller.check();
  expect(f.update.close).toHaveBeenCalledOnce();
});
it('never downloads or installs while there are active tasks or unsaved settings', async () => {
  const f = fixture();
  await f.controller.check();
  f.controller.blocked = () => true;
  await f.controller.install();
  expect(f.update.download).not.toHaveBeenCalled();
  expect(f.update.install).not.toHaveBeenCalled();
});
it('rechecks activity after download and never interrupts newly started work', async () => {
  const f = fixture();
  await f.controller.check();
  f.update.download.mockImplementation(async () => {
    f.controller.blocked = () => true;
  });
  await f.controller.install();
  expect(f.update.install).not.toHaveBeenCalled();
  expect(f.controller.snapshot().status).toBe('available');
});
it('installs only after a successful verified download and restarts', async () => {
  const f = fixture();
  await f.controller.check();
  await f.controller.install();
  expect(f.update.install).toHaveBeenCalledOnce();
  expect(f.restart).toHaveBeenCalledOnce();
});
it('keeps the current application when signature verification or download fails', async () => {
  const f = fixture();
  await f.controller.check();
  f.update.download.mockRejectedValueOnce(new Error('signature mismatch'));
  await f.controller.install();
  expect(f.update.install).not.toHaveBeenCalled();
  expect(f.restart).not.toHaveBeenCalled();
  expect(f.controller.snapshot().status).toBe('available');
});

it('prompts once per launch and dismissal survives manual rechecks and remounts', async () => {
  const f = fixture();
  await Promise.all([f.controller.checkAtStartup(), f.controller.checkAtStartup()]);
  expect(f.check).toHaveBeenCalledOnce();
  expect(f.controller.snapshot().startupPrompt).toBe(true);
  expect(f.update.download).not.toHaveBeenCalled();
  f.controller.dismissStartupPrompt();
  await f.controller.checkAtStartup();
  await f.controller.check();
  expect(f.controller.snapshot().startupPrompt).toBe(false);
  const nextLaunch = fixture();
  await nextLaunch.controller.checkAtStartup();
  expect(nextLaunch.controller.snapshot().startupPrompt).toBe(true);
});
it('keeps startup silent when up to date or offline, without blocking manual checks', async () => {
  for (const check of [
    vi.fn(async () => null),
    vi.fn(async () => {
      throw Error('offline');
    }),
  ]) {
    const controller = new AppUpdates(check, vi.fn());
    await controller.checkAtStartup();
    await controller.checkAtStartup();
    expect(check).toHaveBeenCalledOnce();
    expect(controller.snapshot().startupPrompt).toBe(false);
    await controller.check();
    expect(check).toHaveBeenCalledTimes(2);
  }
});
it('keeps the prompt visible for recovery when installation is blocked', async () => {
  const f = fixture();
  await f.controller.checkAtStartup();
  f.controller.blocked = () => true;
  await f.controller.install();
  expect(f.controller.snapshot().startupPrompt).toBe(true);
  expect(f.controller.snapshot().error).toBeTruthy();
  expect(f.update.download).not.toHaveBeenCalled();
  f.controller.dismissStartupPrompt();
  expect(f.controller.snapshot().startupPrompt).toBe(false);
});

it('automatically downloads at startup then counts down before installing and restarting', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.controller.setAutomatic(true);
  await f.controller.checkAtStartup();
  expect(f.update.download).toHaveBeenCalledOnce();
  expect(f.controller.snapshot()).toMatchObject({
    status: 'countdown',
    seconds: 5,
    downloaded: true,
    startupPrompt: true,
  });
  await vi.advanceTimersByTimeAsync(4999);
  expect(f.update.install).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(f.update.install).toHaveBeenCalledOnce();
  expect(f.restart).toHaveBeenCalledOnce();
});

it('downloads while busy, waits for drafts/tasks, and resets countdown if work resumes', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.controller.blocked = () => true;
  f.controller.setAutomatic(true);
  await f.controller.checkAtStartup();
  expect(f.update.download).toHaveBeenCalledOnce();
  expect(f.controller.snapshot().status).toBe('waiting');
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.update.install).not.toHaveBeenCalled();
  f.controller.blocked = () => false;
  await vi.advanceTimersByTimeAsync(4500);
  f.controller.blocked = () => true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.controller.snapshot().status).toBe('waiting');
  expect(f.update.install).not.toHaveBeenCalled();
  f.controller.blocked = () => false;
  await vi.advanceTimersByTimeAsync(5250);
  expect(f.update.install).toHaveBeenCalledOnce();
  expect(f.update.download).toHaveBeenCalledOnce();
});

it('turning automatic updates off during download never installs after the download completes', async () => {
  vi.useFakeTimers();
  const f = fixture();
  let finish!: () => void;
  f.update.download.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  f.controller.setAutomatic(true);
  const startup = f.controller.checkAtStartup();
  await vi.advanceTimersByTimeAsync(0);
  f.controller.setAutomatic(false);
  finish();
  await startup;
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.controller.snapshot()).toMatchObject({ status: 'available', downloaded: true });
  expect(f.update.install).not.toHaveBeenCalled();
  await f.controller.install();
  expect(f.update.download).toHaveBeenCalledOnce();
  expect(f.restart).toHaveBeenCalledOnce();
});

it('Later cancels automatic installation for this launch without turning off the saved preference', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.controller.setAutomatic(true);
  await f.controller.checkAtStartup();
  f.controller.dismissStartupPrompt();
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.controller.snapshot()).toMatchObject({
    automatic: true,
    status: 'available',
    startupPrompt: false,
  });
  expect(f.update.install).not.toHaveBeenCalled();
});

it('automatic signature failure never starts an installation timer', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.update.download.mockRejectedValue(new Error('invalid signature'));
  f.controller.setAutomatic(true);
  await f.controller.checkAtStartup();
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.controller.snapshot()).toMatchObject({ downloaded: false, status: 'available' });
  expect(f.update.install).not.toHaveBeenCalled();
  expect(f.restart).not.toHaveBeenCalled();
});
