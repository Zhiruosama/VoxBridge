export const sidebarDefault = 196;
export const sidebarMinimum = 180;
export const sidebarMaximum = 360;
export const sidebarStorageKey = 'voxbridge.sidebar-width.v1';

export function sidebarLimit(containerWidth: number) {
  // Preserve 400 px of content plus shell padding and the column gap.
  return Math.max(sidebarMinimum, Math.min(sidebarMaximum, containerWidth - 422));
}
export function sidebarWidth(value: unknown, maximum = sidebarMaximum) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(sidebarMinimum, Math.min(maximum, Math.round(value)))
    : Math.min(sidebarDefault, maximum);
}
