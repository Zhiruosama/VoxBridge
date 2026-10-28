import { describe, expect, it } from 'vitest';
import libSource from '../../src-tauri/src/lib.rs?raw';
import buildSource from '../../src-tauri/build.rs?raw';
import main from '../../src-tauri/capabilities/main.json';
import subtitle from '../../src-tauri/capabilities/subtitle.json';
import setup from '../../src-tauri/capabilities/setup.json';
import macChrome from '../../src-tauri/capabilities/macos-chrome.json';
import windowsChrome from '../../src-tauri/capabilities/windows-chrome.json';

describe('native command permission integration', () => {
  it('authorizes the shared titlebar drag script on both desktop platforms', () => {
    expect(macChrome.platforms).toEqual(['macOS']);
    expect(windowsChrome.platforms).toEqual(['windows']);
    for (const chrome of [macChrome, windowsChrome]) {
      expect(chrome.windows).toEqual(['main']);
      expect(chrome.permissions).toContain('core:window:allow-start-dragging');
    }
    expect(macChrome.permissions).toContain('allow-zoom-main-window');
    expect(windowsChrome.permissions).toContain('core:window:allow-internal-toggle-maximize');
    expect(subtitle.permissions).not.toContain('allow-zoom-main-window');
    expect(macChrome.permissions).toHaveLength(2);
  });
  it('isolates installer commands and excludes saved keys and audio from setup', () => {
    expect(setup.windows).toEqual(['setup']);
    for (const operation of [
      'minimize',
      'close',
      'start-dragging',
      'toggle-maximize',
      'internal-toggle-maximize',
      'is-maximized',
    ]) {
      expect(setup.permissions).toContain(`core:window:allow-${operation}`);
    }
    for (const command of [
      'setup-inspect',
      'setup-choose-folder',
      'setup-install',
      'setup-finish',
    ]) {
      expect(setup.permissions).toContain(`allow-${command}`);
      expect(main.permissions).not.toContain(`allow-${command}`);
      expect(subtitle.permissions).not.toContain(`allow-${command}`);
    }
    for (const permission of [
      'allow-set-credential',
      'allow-start-listening',
      'updater:default',
      'process:allow-restart',
    ]) {
      expect(setup.permissions).not.toContain(permission);
    }
  });
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
