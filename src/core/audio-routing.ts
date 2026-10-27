import type { AudioRouting, OutputDevice } from './types';

export const systemDefaultOutputId = '__system_default__';
export const virtualMicrophoneOutputId = '__virtual_microphone__';

/** Upgrade only exact, unambiguous Windows device names; never guess a route. */
export function migrateLegacyOutputRouting(
  audio: AudioRouting,
  devices: OutputDevice[],
): AudioRouting {
  function upgrade(value: string) {
    if (
      !value ||
      value === systemDefaultOutputId ||
      value === virtualMicrophoneOutputId ||
      value.startsWith('windows-output:') ||
      value.startsWith('macos-output:')
    )
      return value;
    const candidates = new Set(
      devices
        .filter((device) => device.id.startsWith('windows-output:') && device.name === value)
        .map((device) => device.id),
    );
    return candidates.size === 1 ? [...candidates][0] : value;
  }
  const previewDeviceId = upgrade(audio.previewDeviceId);
  const sendDeviceId = upgrade(audio.sendDeviceId);
  return previewDeviceId === audio.previewDeviceId && sendDeviceId === audio.sendDeviceId
    ? audio
    : { ...audio, previewDeviceId, sendDeviceId };
}

export function previewDeviceOptions(devices: OutputDevice[], value: string) {
  return [
    { value: systemDefaultOutputId, label: '系统默认' },
    ...outputDeviceOptions(devices, value === systemDefaultOutputId ? '' : value),
  ];
}

export function sendDeviceOptions(devices: OutputDevice[], value: string) {
  return [
    { value: virtualMicrophoneOutputId, label: '自动选择虚拟麦克风（推荐）' },
    ...previewDeviceOptions(devices, value === virtualMicrophoneOutputId ? '' : value),
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
      label:
        value.startsWith('macos-output:') || value.startsWith('windows-output:')
          ? '已保存设备（不可用，请重新选择）'
          : `${value}（不可用，请重新选择）`,
    });
  }
  return options;
}
