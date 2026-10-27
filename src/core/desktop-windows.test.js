// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const config = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));

it('keeps every shared desktop window available in the Windows array override', () => {
  const shared = config('../../src-tauri/tauri.conf.json').app.windows;
  const windows = config('../../src-tauri/tauri.windows.conf.json').app.windows;
  expect(windows.map((window) => window.label).sort()).toEqual(
    shared.map((window) => window.label).sort(),
  );
  for (const window of shared.filter((window) => window.label !== 'main')) {
    // Tauri replaces arrays instead of merging entries by label. Preserve routing,
    // hidden startup, focus, transparency and size constraints for both floats.
    expect(windows.find((entry) => entry.label === window.label)).toEqual(window);
    // Undecorated native shadows introduce a second 1px Windows frame outside
    // the rounded web surface. Both floating windows must disable that frame.
    expect(window.shadow).toBe(false);
  }
});
