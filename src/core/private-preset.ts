import { parseSettings, saveSettings } from './settings';

export async function bootstrapPrivatePreset(
  request: (install: boolean) => Promise<unknown>,
  store: Pick<Storage, 'getItem'> = localStorage,
  save = saveSettings,
) {
  const key = 'voxbridge.settings.v1';
  if ([key, `${key}.backup`, `${key}.unreadable`].some((name) => store.getItem(name) !== null))
    return;
  const raw = await request(false);
  if (!raw) return;
  const settings = parseSettings(raw);
  await request(true);
  save(settings);
}
