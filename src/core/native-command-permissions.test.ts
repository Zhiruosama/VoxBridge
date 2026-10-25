import { describe, expect, it } from 'vitest';
import libSource from '../../src-tauri/src/lib.rs?raw';
import buildSource from '../../src-tauri/build.rs?raw';
import main from '../../src-tauri/capabilities/main.json';
import subtitle from '../../src-tauri/capabilities/subtitle.json';

describe('native command permission integration', () => {
  it('declares every registered custom command in the Tauri build manifest', () => {
    const handler = libSource.match(/tauri::generate_handler!\[([\s\S]*?)\]/)![1];
    const registered = handler
      .split(',')
      .map((name) => name.trim().split('::').at(-1))
      .filter(Boolean);
    const manifest = buildSource.match(/\.commands\(&\[([\s\S]*?)\]/)![1];
    const declared = [...manifest.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
    expect(declared.slice().sort()).toEqual(registered.slice().sort());
  });
  it('allows all queued speech operations only in the main window', () => {
    expect(main.windows).toEqual(['main']);
    for (const command of ['prepare_speech', 'play_prepared_speech', 'discard_prepared_speech']) {
      const permission = `allow-${command.replaceAll('_', '-')}`;
      expect(main.permissions).toContain(permission);
      expect(subtitle.permissions).not.toContain(permission);
    }
  });
  it('keeps application installation and Windows settings actions out of the subtitle window', () => {
    for (const permission of [
      'updater:default',
      'process:allow-restart',
      'allow-open-audio-settings',
      'allow-microphone-access',
    ]) {
      expect(main.permissions).toContain(permission);
      expect(subtitle.permissions).not.toContain(permission);
    }
  });
});
