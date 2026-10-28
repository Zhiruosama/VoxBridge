import { describe, expect, it, vi } from 'vitest';
import { bootstrapPrivatePreset } from './private-preset';
import { defaults } from './settings';

describe('private first-run configuration', () => {
  it.each([
    'voxbridge.settings.v1',
    'voxbridge.settings.v1.backup',
    'voxbridge.settings.v1.unreadable',
  ])('never touches existing or recovery configuration: %s', async (key) => {
    const request = vi.fn();
    const save = vi.fn();
    await bootstrapPrivatePreset(request, { getItem: (name) => (name === key ? '' : null) }, save);
    expect(request).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it('seeds a fresh profile only after credentials are imported', async () => {
    const events: string[] = [];
    await bootstrapPrivatePreset(
      async (install) => {
        events.push(install ? 'credentials' : 'read');
        return defaults;
      },
      { getItem: () => null },
      () => {
        events.push('save');
      },
    );
    expect(events).toEqual(['read', 'credentials', 'save']);
  });
  it('public builds are inert and credential failures do not save partial settings', async () => {
    const save = vi.fn();
    await bootstrapPrivatePreset(async () => null, { getItem: () => null }, save);
    expect(save).not.toHaveBeenCalled();
    await expect(
      bootstrapPrivatePreset(
        async (install) => {
          if (install) throw Error('vault unavailable');
          return defaults;
        },
        { getItem: () => null },
        save,
      ),
    ).rejects.toThrow('vault unavailable');
    expect(save).not.toHaveBeenCalled();
  });
});
