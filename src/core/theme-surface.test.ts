import { afterEach, expect, it, vi } from 'vitest';
import { ThemeSurface } from './theme-surface';
function fixture() {
  const inline = new Map<string, string>();
  const root = {
    dataset: { theme: 'dark' },
    style: {
      getPropertyValue: (key: string) => inline.get(key) ?? '',
      getPropertyPriority: () => '',
      setProperty: (key: string, value: string) => {
        inline.set(key, value);
      },
      removeProperty: (key: string) => {
        inline.delete(key);
      },
    },
  };
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (key: string) =>
      inline.get(key) ??
      (key === '--text'
        ? root.dataset.theme === 'dark'
          ? '#ececee'
          : '#242426'
        : key === '--composer-border'
          ? root.dataset.theme === 'dark'
            ? 'rgb(255 255 255 / 9%)'
            : 'rgb(0 0 0 / 7%)'
          : root.dataset.theme === 'dark'
            ? '#181818'
            : '#f0f0ee'),
  }));
  return { root, inline, surface: new ThemeSurface(root as unknown as HTMLElement) };
}
afterEach(() => vi.unstubAllGlobals());
it('uses the same progress for all surfaces while keeping text on a readable endpoint', () => {
  const f = fixture();
  const paint = f.surface.prepare('light');
  paint(0.25);
  expect(f.inline.get('--side')).toBe('rgba(78, 78, 78, 1)');
  expect(f.inline.get('--bg')).toBe(f.inline.get('--side'));
  expect(f.inline.get('--text')).toBe('#ececee');
  paint(0.5);
  expect(f.inline.get('--side')).toBe('rgba(132, 132, 131, 1)');
  expect(f.inline.get('--text')).toBe('#242426');
  expect(f.inline.get('--composer-border')).toBe('rgba(128, 128, 128, 0.08)');
  f.surface.finish();
  expect(f.inline.size).toBe(0);
  expect(f.root.dataset.theme).toBe('light');
});
it('retargets from the visible palette without flashing an endpoint or leaking inline overrides', () => {
  const f = fixture();
  const first = f.surface.prepare('light');
  first(0.25);
  const before = f.inline.get('--side');
  const reverse = f.surface.prepare('dark');
  expect(f.inline.get('--side')).toBe(before);
  reverse(1);
  expect(f.inline.get('--side')).toBe('rgba(24, 24, 24, 1)');
  f.surface.finish();
  expect(f.inline.size).toBe(0);
  expect(f.root.dataset.theme).toBe('dark');
});
