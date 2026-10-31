export interface TextOverlayAppearance {
  backgroundOpacity: number;
  fontSize: number;
  lineHeight: number;
  textColor: string;
}
export const textOverlayAppearanceDefaults: TextOverlayAppearance = {
  backgroundOpacity: 0.9,
  fontSize: 17,
  lineHeight: 1.7,
  textColor: '#f5f5f7',
};
export function parseTextOverlayAppearance(value: unknown): TextOverlayAppearance {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const bounded = (
    key: 'backgroundOpacity' | 'fontSize' | 'lineHeight',
    min: number,
    max: number,
  ) => {
    const number = input[key];
    return typeof number === 'number' && Number.isFinite(number)
      ? Math.max(min, Math.min(max, number))
      : textOverlayAppearanceDefaults[key];
  };
  return {
    backgroundOpacity: bounded('backgroundOpacity', 0.2, 1),
    fontSize: Math.round(bounded('fontSize', 14, 40)),
    lineHeight: bounded('lineHeight', 1.2, 2.2),
    textColor:
      typeof input.textColor === 'string' && /^#[\da-f]{6}$/i.test(input.textColor)
        ? input.textColor.toLowerCase()
        : textOverlayAppearanceDefaults.textColor,
  };
}

export interface TextOverlaySnapshot {
  appearance: TextOverlayAppearance;
  version: number;
  uiLanguage: 'zh-CN' | 'en' | 'ru';
  result: string;
  target: string;
  busy: boolean;
  error: string;
  canTranslate: boolean;
  watching: boolean;
  automatic: boolean;
  copied: boolean;
  copyError: boolean;
}
export type TextOverlayAction =
  | { action: 'translate' | 'focus' | 'pause' | 'start' }
  | { action: 'automatic'; enabled: boolean }
  | { action: 'copy'; text: string };
export const textOverlayDefaults: TextOverlaySnapshot = {
  appearance: { ...textOverlayAppearanceDefaults },
  version: 0,
  uiLanguage: 'zh-CN',
  result: '',
  target: '',
  busy: false,
  error: '',
  canTranslate: false,
  watching: false,
  automatic: false,
  copied: false,
  copyError: false,
};
