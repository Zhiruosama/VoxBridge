export const sidebarDefault = 196;
export const sidebarMinimum = 180;
export const sidebarMaximum = 360;
export const workspaceMinimum = 780;
export const sidebarStorageKey = 'voxbridge.sidebar-width.v1';

export function sidebarLimit(containerWidth: number) {
  // Keep the composer above its 700px wrapping breakpoint, including its 48px
  // horizontal padding and borders. The shell adds 16px padding and a 6px gap.
  return Math.max(sidebarMinimum, Math.min(sidebarMaximum, containerWidth - 22 - workspaceMinimum));
}
export function sidebarWidth(value: unknown, maximum = sidebarMaximum) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(sidebarMinimum, Math.min(maximum, Math.round(value)))
    : Math.min(sidebarDefault, maximum);
}
