import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipboardWatcher } from './clipboard-watch';
function fixture() {
  let text = 'existing clipboard';
  const read = vi.fn(async () => text);
  const onText = vi.fn();
  const onStatus = vi.fn();
  const watcher = new ClipboardWatcher({ read, onText, onStatus });
  return {
    watcher,
    read,
    onText,
    onStatus,
    copy: (value: string) => {
      text = value;
    },
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
async function tick(ms = 500) {
  await vi.advanceTimersByTimeAsync(ms);
}
describe('explicit clipboard watching', () => {
  it('does not read before opt-in, skips existing content and only emits new nonempty text once', async () => {
    const f = fixture();
    expect(f.read).not.toHaveBeenCalled();
    f.watcher.start();
    await tick(0);
    expect(f.onText).not.toHaveBeenCalled();
    f.copy('New copied text');
    await tick(1500);
    expect(f.onText.mock.calls).toEqual([['New copied text']]);
    f.copy('  ');
    await tick();
    expect(f.onText).toHaveBeenCalledOnce();
    f.watcher.stop();
    const count = f.read.mock.calls.length;
    f.copy('off');
    await tick(2000);
    expect(f.read).toHaveBeenCalledTimes(count);
  });
  it('ignores own output once, even after a long pause, and allows new external copies later', async () => {
    const f = fixture();
    f.watcher.start();
    await tick(0);
    f.watcher.ignoreCopy('Our translation');
    f.copy('Our translation');
    await tick(10000);
    expect(f.onText).not.toHaveBeenCalled();
    f.copy('External text');
    await tick();
    f.copy('Our translation');
    await tick();
    expect(f.onText.mock.calls).toEqual([['External text'], ['Our translation']]);
  });
  it('rejects oversized text without truncating it into a paid request, and supports 2000 Unicode characters', async () => {
    const f = fixture();
    f.watcher.start();
    await tick(0);
    f.copy('😀'.repeat(2001));
    await tick(1000);
    expect(f.onText).not.toHaveBeenCalled();
    expect(f.onStatus.mock.calls.at(-1)?.[0]).toContain('2000');
    f.copy('😀'.repeat(2000));
    await tick();
    expect(f.onText.mock.calls[0][0]).toHaveLength(4000);
  });
  it('never overlaps slow reads and discards a late read after stop', async () => {
    const f = fixture();
    let finish!: (text: string) => void;
    f.read.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    f.watcher.start();
    await tick(3000);
    expect(f.read).toHaveBeenCalledOnce();
    f.watcher.stop();
    finish('private late text');
    await tick(3000);
    expect(f.onText).not.toHaveBeenCalled();
    expect(f.onStatus).not.toHaveBeenCalled();
    expect(f.read).toHaveBeenCalledOnce();
  });
  it('recovers from a nontext or unavailable clipboard without logging its content', async () => {
    const f = fixture();
    f.read.mockRejectedValueOnce(new Error('private native error'));
    f.watcher.start();
    await tick(0);
    expect(f.onStatus.mock.calls[0][0]).not.toContain('private');
    f.copy('Readable text');
    await tick();
    expect(f.onText).toHaveBeenCalledWith('Readable text');
    f.watcher.stop();
  });
});
