export const textSplitStorageKey = 'voxbridge.text-translation.split';
export function textSplitRatio(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(30, Math.min(70, Math.round(value)))
    : 50;
}
export function textPanelOpacity(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : 85;
}
