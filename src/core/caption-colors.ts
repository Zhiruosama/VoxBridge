import type { Settings } from './types';

export const captionColorDefaults = { recognition: '#ffffff', expression: '#ffffff' };
export function parseCaptionColors(value: unknown): Settings['captionColors'] {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const color = (key: keyof Settings['captionColors']) =>
    typeof input[key] === 'string' && /^#[\da-f]{6}$/i.test(input[key])
      ? input[key].toLowerCase()
      : captionColorDefaults[key];
  return { recognition: color('recognition'), expression: color('expression') };
}
