import { describe, expect, it } from 'vitest';
import { outputDeviceOptions } from './audio-routing';

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
