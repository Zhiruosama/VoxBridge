import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import commonConfig from '../../src-tauri/tauri.conf.json';
import windowsConfig from '../../src-tauri/tauri.windows.conf.json';

// File-based regression belongs to the Node test runner, not browser TS sources.
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
it('keeps text translation side by side before a stale wide sidebar preference is clamped', () => {
  const breakpoint = Number(
    /@container text-translation \(max-width:\s*(\d+)px\)/.exec(styles)?.[1],
  );
  expect(breakpoint).toBeGreaterThanOrEqual(2 * 240 + 18);
  for (const config of [commonConfig, windowsConfig]) {
    const main = config.app.windows.find((window) => window.label === 'main');
    // Old 360px sidebar before ResizeObserver, plus shell, panel padding/borders
    // and a Windows scrollbar: even this conservative case must stay split.
    const textContent = main.minWidth - 360 - 22 - 2 - 56 - 16;
    expect(textContent).toBeGreaterThan(breakpoint);
  }
});
