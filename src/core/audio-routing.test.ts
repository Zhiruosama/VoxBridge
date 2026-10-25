import { describe, expect, it } from 'vitest';
import { outputDeviceOptions, previewDeviceOptions, systemDefaultOutputId } from './audio-routing';
import { migrateLegacyOutputRouting } from './audio-routing';

describe('Windows output configuration upgrade', () => {
  const outputs = [
    { id: 'windows-output:61', name: 'Headphones' },
    { id: 'windows-output:62', name: 'Virtual cable' },
  ];

  it('upgrades both exact names while preserving recording and monitoring preferences', () => {
    const audio = {
      previewDeviceId: 'Headphones',
      sendDeviceId: 'Virtual cable',
      inputDeviceId: 'mic:61',
      monitorEnabled: true,
    };
    expect(migrateLegacyOutputRouting(audio, outputs)).toEqual({
      ...audio,
      previewDeviceId: 'windows-output:61',
      sendDeviceId: 'windows-output:62',
    });
    expect(audio.previewDeviceId).toBe('Headphones');
  });

  it('never guesses among duplicate names or selects a default for an unavailable device', () => {
    const audio = { previewDeviceId: 'Headphones', sendDeviceId: 'Missing' };
    expect(
      migrateLegacyOutputRouting(audio, [
        ...outputs,
        { id: 'windows-output:63', name: 'Headphones' },
      ]),
    ).toBe(audio);
    expect(migrateLegacyOutputRouting(audio, [])).toBe(audio);
    expect(
      migrateLegacyOutputRouting({ ...audio, previewDeviceId: 'headphones' }, outputs)
        .previewDeviceId,
    ).toBe('headphones');
  });

  it('preserves default, empty, disconnected and foreign platform IDs', () => {
    for (const id of ['', systemDefaultOutputId, 'windows-output:99', 'macos-output:99']) {
      const audio = { previewDeviceId: id, sendDeviceId: id };
      expect(
        migrateLegacyOutputRouting(audio, [...outputs, { id: 'windows-output:64', name: id }]),
      ).toBe(audio);
    }
    const audio = { previewDeviceId: 'Headphones', sendDeviceId: '' };
    expect(migrateLegacyOutputRouting(audio, devices)).toBe(audio);
  });

  it('deduplicates repeated inventory entries and remains stable after migration', () => {
    const audio = migrateLegacyOutputRouting({ previewDeviceId: 'Headphones', sendDeviceId: '' }, [
      ...outputs,
      outputs[0],
    ]);
    expect(audio.previewDeviceId).toBe('windows-output:61');
    expect(migrateLegacyOutputRouting(audio, outputs)).toBe(audio);
  });
});

const devices = [
  { id: 'macos-output:62', name: 'Headphones' },
  { id: 'macos-output:61', name: 'Headphones' },
];

describe('output device options', () => {
  it('preserves distinct identifiers for same-name devices with stable labels', () => {
    const options = outputDeviceOptions(devices, '');
    expect(options).toEqual([
      { value: 'macos-output:61', label: 'Headphones · 1' },
      { value: 'macos-output:62', label: 'Headphones · 2' },
    ]);
    expect(outputDeviceOptions([...devices].reverse(), '')).toEqual(options);
  });
  it('does not migrate a legacy name or a disconnected UID to an available device', () => {
    expect(outputDeviceOptions(devices, 'Headphones').at(-1)).toEqual({
      value: 'Headphones',
      label: 'Headphones（不可用，请重新选择）',
    });
    expect(outputDeviceOptions(devices, 'macos-output:63').at(-1)).toEqual({
      value: 'macos-output:63',
      label: '已保存设备（不可用，请重新选择）',
    });
  });
  it('retains a saved UID across device display-name changes', () => {
    const renamed = [{ id: 'macos-output:61', name: 'Renamed headphones' }];
    expect(outputDeviceOptions(renamed, 'macos-output:61')).toEqual([
      { value: 'macos-output:61', label: 'Renamed headphones' },
    ]);
  });
  it('deduplicates repeated identifiers without inventing a default selection', () => {
    expect(outputDeviceOptions([...devices, devices[0]], '')).toHaveLength(2);
    expect(outputDeviceOptions([], '')).toEqual([]);
    expect(outputDeviceOptions([], 'Headphones')).toHaveLength(1);
  });
});

describe('system default preview output', () => {
  it('keeps a stable default option as headphones disconnect and reconnect', () => {
    const option = { value: systemDefaultOutputId, label: '系统默认' };
    expect(previewDeviceOptions(devices, systemDefaultOutputId)[0]).toEqual(option);
    expect(previewDeviceOptions([], systemDefaultOutputId)).toEqual([option]);
    expect(previewDeviceOptions([], 'headphones')).toEqual([
      option,
      { value: 'headphones', label: 'headphones（不可用，请重新选择）' },
    ]);
    expect(outputDeviceOptions(devices, '')).not.toContainEqual(option);
  });
});
