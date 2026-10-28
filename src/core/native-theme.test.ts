import { expect, it, vi } from 'vitest';
import { syncNativeTheme } from './native-theme';
it('applies native preferences once without an independent animation clock', async () => {
  for (const theme of ['light', 'dark', 'system'] as const) {
    const window = { setTheme: vi.fn(async () => {}), setBackgroundColor: vi.fn(async () => {}) };
    const resolved = theme === 'dark' ? 'dark' : 'light';
    await syncNativeTheme(window, {
      theme,
      resolved,
      signal: new AbortController().signal,
    });
    expect(window.setTheme).toHaveBeenCalledExactlyOnceWith(theme === 'system' ? null : theme);
    expect(window.setBackgroundColor).toHaveBeenCalledExactlyOnceWith(
      theme === 'dark' ? '#181818' : '#f0f0ee',
    );
  }
});
it('stops obsolete native updates before and after the appearance IPC', async () => {
  const abort = new AbortController();
  const window = {
    setTheme: vi.fn(async () => {
      abort.abort();
    }),
    setBackgroundColor: vi.fn(async () => {}),
  };
  await syncNativeTheme(window, { theme: 'dark', resolved: 'dark', signal: abort.signal });
  expect(window.setBackgroundColor).not.toHaveBeenCalled();
  await syncNativeTheme(window, { theme: 'light', resolved: 'light', signal: abort.signal });
  expect(window.setTheme).toHaveBeenCalledOnce();
});
