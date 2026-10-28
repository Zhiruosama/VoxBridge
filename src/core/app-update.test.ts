import { expect, it, vi } from 'vitest';
import { AppUpdates } from './app-update';

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

it('explains the actual blocking task and allows update when it ends', async () => {
  const f = fixture();
  await f.controller.check();
  f.controller.blocked = () => '文本翻译正在进行，请完成或取消后再更新。';
  await f.controller.install();
  expect(f.controller.snapshot().error).toContain('文本翻译');
  expect(f.update.download).not.toHaveBeenCalled();
  f.controller.blocked = () => false;
  await f.controller.install();
  expect(f.update.install).toHaveBeenCalledOnce();
});
it('preserves the latest drafts only after the download and final activity check', async () => {
  const f = fixture();
  const prepare = vi.fn();
  f.controller.beforeInstall = prepare;
  await f.controller.check();
  f.update.install.mockImplementation(async () => {
    expect(prepare).toHaveBeenCalledOnce();
  });
  await f.controller.install();
  expect(f.update.download.mock.invocationCallOrder[0]).toBeLessThan(
    prepare.mock.invocationCallOrder[0],
  );
});
it('does not install when preserving drafts fails, and removes the backup after an install failure', async () => {
  const f = fixture();
  await f.controller.check();
  f.controller.beforeInstall = () => {
    throw Error('storage full');
  };
  await f.controller.install();
  expect(f.update.install).not.toHaveBeenCalled();
  expect(f.controller.snapshot().error).toContain('暂存失败');
  f.controller.beforeInstall = () => {};
  f.controller.installFailed = vi.fn();
  f.update.install.mockRejectedValueOnce(Error('native install failed'));
  await f.controller.install();
  expect(f.controller.installFailed).toHaveBeenCalledOnce();
  expect(f.restart).not.toHaveBeenCalled();
});
