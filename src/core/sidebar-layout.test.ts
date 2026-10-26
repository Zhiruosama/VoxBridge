import { describe, expect, it } from 'vitest';
import {
  sidebarDefault,
  sidebarLimit,
  sidebarMinimum,
  sidebarWidth,
  workspaceMinimum,
} from './sidebar-layout';
import commonConfig from '../../src-tauri/tauri.conf.json';
import windowsConfig from '../../src-tauri/tauri.windows.conf.json';
import { readFileSync } from 'node:fs';
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

describe('sidebar layout bounds', () => {
  it('rejects corrupt preferences and clamps stored widths', () => {
    for (const value of [null, undefined, '300', NaN, Infinity, {}])
      expect(sidebarWidth(value)).toBe(sidebarDefault);
    expect(sidebarWidth(-200)).toBe(180);
    expect(sidebarWidth(500)).toBe(360);
  });
  it('preserves content room in the minimum desktop window without discarding wide preferences', () => {
    expect(sidebarLimit(1180)).toBe(360);
    expect(sidebarLimit(1062)).toBe(260);
    expect(sidebarWidth(360, sidebarLimit(1062))).toBe(260);
    expect(sidebarWidth(360, sidebarLimit(1180))).toBe(360);
    expect(sidebarLimit(360)).toBe(180);
  });
  it('keeps the composer on one row at native minimum size and at maximum sidebar drag', () => {
    for (const config of [commonConfig, windowsConfig]) {
      const main = config.app.windows.find((window) => window.label === 'main')!;
      expect(main.minWidth).toBeGreaterThanOrEqual(sidebarMinimum + 22 + workspaceMinimum);
      expect(main.width).toBeGreaterThanOrEqual(main.minWidth!);
      for (const width of [main.minWidth!, main.width, 1440]) {
        const available = width - sidebarLimit(width) - 22;
        expect(available).toBeGreaterThanOrEqual(workspaceMinimum);
        expect(available - 48 - 4).toBeGreaterThan(700);
      }
    }
  });
  it('keeps text translation side by side even before a stale wide sidebar preference is clamped', () => {
    const breakpoint = Number(
      /@container text-translation \(max-width:\s*(\d+)px\)/.exec(styles)?.[1],
    );
    expect(breakpoint).toBeGreaterThanOrEqual(2 * 240 + 18);
    for (const config of [commonConfig, windowsConfig]) {
      const main = config.app.windows.find((window) => window.label === 'main')!;
      // Deliberately model the old 360px preference before ResizeObserver fires.
      // Include the main border, text workspace padding and Windows scrollbar.
      const textContent = main.minWidth! - 360 - 22 - 2 - 56 - 16;
      expect(textContent).toBeGreaterThan(breakpoint);
    }
  });
});
