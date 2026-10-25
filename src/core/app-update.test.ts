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
