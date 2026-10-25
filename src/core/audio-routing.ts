import type { OutputDevice } from './types';

export const systemDefaultOutputId = '__system_default__';

export function previewDeviceOptions(devices: OutputDevice[], value: string) {
  return [
    { value: systemDefaultOutputId, label: '系统默认' },
    ...outputDeviceOptions(devices, value === systemDefaultOutputId ? '' : value),
  ];
}

export const voxBridgeOutputId =
  'macos-output:636f6d2e766f786272696467652e617564696f2e646576696365';

export function outputDeviceOptions(devices: OutputDevice[], value: string) {
  const unique = [...new Map(devices.map((device) => [device.id, device])).values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const counts = new Map<string, number>();
  for (const device of unique) counts.set(device.name, (counts.get(device.name) ?? 0) + 1);
  const positions = new Map<string, number>();
  const options = unique.map((device) => {
    const position = (positions.get(device.name) ?? 0) + 1;
    positions.set(device.name, position);
    return {
      value: device.id,
      label: counts.get(device.name)! > 1 ? `${device.name} · ${position}` : device.name,
    };
  });
  if (value && !unique.some((device) => device.id === value)) {
    options.push({
      value,
      label: value.startsWith('macos-output:')
        ? '已保存设备（不可用，请重新选择）'
        : `${value}（不可用，请重新选择）`,
    });
  }
  return options;
}
