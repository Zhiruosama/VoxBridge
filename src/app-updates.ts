import { isTauri } from '@tauri-apps/api/core';
import { AppUpdates } from './core/app-update';

export const appUpdates = new AppUpdates(
  async () => {
    if (!isTauri()) return null;
    const { check } = await import('@tauri-apps/plugin-updater');
    return check({ timeout: 15000 });
  },
  async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  },
);
