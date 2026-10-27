import { afterEach, expect, it, vi } from 'vitest';
import { syncNativeTheme, type ChromeColor } from './native-theme';

function fixture() {
  let next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('performance', { now: () => 0 });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++next, fn);
    return next;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const window = {
    setTheme: vi.fn(async () => {}),
    setBackgroundColor: vi.fn(async (_color: string) => {}),
  };
  const abort = new AbortController();
  const colors: ChromeColor[] = [];
  const options = {
    theme: 'light' as const,
    resolved: 'light' as const,
    from: [24, 24, 24] as ChromeColor,
    animate: true,
    signal: abort.signal,
    onColor: (color: ChromeColor) => colors.push(color),
  };
  async function paint(time: number) {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((fn) => fn(time));
    for (let i = 0; i < 12; i++) await Promise.resolve();
  }
  return { frames, window, abort, colors, options, paint };
}
afterEach(() => vi.unstubAllGlobals());
it('blends native chrome through intermediate colors and ends on the exact DOM theme color', async () => {
  const f = fixture();
  const task = syncNativeTheme(f.window, f.options);
  await f.paint(100);
  expect(f.colors[0][0]).toBeGreaterThan(24);
  expect(f.colors[0][0]).toBeLessThan(240);
  expect(f.window.setTheme).not.toHaveBeenCalled();
  await f.paint(200);
  expect(f.window.setTheme).toHaveBeenCalledExactlyOnceWith('light');
  await f.paint(400);
  await task;
  expect(f.window.setBackgroundColor).toHaveBeenLastCalledWith('#f0f0ee');
  expect(f.frames.size).toBe(0);
});
it('cancels an interrupted fade and reverses from the actual intermediate color', async () => {
  const f = fixture();
  const task = syncNativeTheme(f.window, f.options);
  await f.paint(100);
  const intermediate = f.colors.at(-1)!;
  f.abort.abort();
  await task;
  expect(f.frames.size).toBe(0);
  const calls = f.window.setBackgroundColor.mock.calls.length;
  await f.paint(400);
  expect(f.window.setBackgroundColor).toHaveBeenCalledTimes(calls);
  const next = syncNativeTheme(f.window, {
    ...f.options,
    theme: 'dark',
    resolved: 'dark',
    from: intermediate,
    signal: new AbortController().signal,
  });
  await f.paint(0);
  expect(f.colors.at(-1)).toEqual(intermediate);
  await f.paint(400);
  await next;
  expect(f.window.setBackgroundColor).toHaveBeenLastCalledWith('#181818');
});
it('remembers a color applied during in-flight IPC cancellation without sending subsequent frames', async () => {
  const f = fixture();
  let finish!: () => void;
  f.window.setBackgroundColor.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const task = syncNativeTheme(f.window, f.options);
  await f.paint(100);
  f.abort.abort();
  finish();
  await task;
  expect(f.colors).toHaveLength(1);
  expect(f.frames.size).toBe(0);
  expect(f.window.setTheme).not.toHaveBeenCalled();
});
it('applies initial and reduced-motion themes without creating animation frames', async () => {
  for (const options of [
    { from: null },
    { animate: false },
    { from: [240, 240, 238] as ChromeColor },
  ]) {
    const f = fixture();
    await syncNativeTheme(f.window, { ...f.options, theme: 'system', ...options });
    expect(f.frames.size).toBe(0);
    expect(f.window.setTheme).toHaveBeenCalledExactlyOnceWith(null);
    expect(f.window.setBackgroundColor).toHaveBeenCalledExactlyOnceWith('#f0f0ee');
  }
});
