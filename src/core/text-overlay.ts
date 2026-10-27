export interface TextOverlaySnapshot {
  version: number;
  uiLanguage: 'zh-CN' | 'en';
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
  | { action: 'translate' | 'focus' | 'pause' }
  | { action: 'copy'; text: string };
export const textOverlayDefaults: TextOverlaySnapshot = {
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
