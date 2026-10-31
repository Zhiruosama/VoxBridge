import { useSyncExternalStore } from 'react';
import english from './en.json';
import russian from './ru.json';

export type UiLanguage = 'zh-CN' | 'en' | 'ru';
const catalogs: Record<'en' | 'ru', Record<string, string>> = { en: english, ru: russian };
const listeners = new Set<() => void>();
export function parseUiLanguage(value: unknown): UiLanguage {
  return value === 'en' || value === 'ru' ? value : 'zh-CN';
}
function storedLanguage(): UiLanguage {
  try {
    return parseUiLanguage(
      JSON.parse(localStorage.getItem('voxbridge.settings.v1') ?? '{}').uiLanguage,
    );
  } catch {
    return 'zh-CN';
  }
}
let language = storedLanguage();
export function setUiLanguage(next: UiLanguage) {
  const parsed = parseUiLanguage(next);
  if (typeof document !== 'undefined') document.documentElement.lang = parsed;
  if (language === parsed) return;
  language = parsed;
  for (const listener of listeners) listener();
}
export function useUiLanguage() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => language,
    () => 'zh-CN' as UiLanguage,
  );
}
export function translatedMessage(key: string, locale: 'en' | 'ru'): string {
  const catalog = catalogs[locale];
  if (Object.hasOwn(catalog, key)) return catalog[key];
  const httpStatus = /^(.*)(（HTTP \d{3}）)$/.exec(key);
  if (httpStatus) return `${translatedMessage(httpStatus[1], locale)} ${httpStatus[2]}`;
  if (key.startsWith('Error: '))
    return `${locale === 'ru' ? 'Ошибка' : 'Error'}: ${translatedMessage(key.slice(7), locale)}`;
  const diagnostic = /^目标：(.+)；返回语言识别：(.+)$/.exec(key);
  if (diagnostic)
    return catalog['目标：{0}；返回语言识别：{1}']
      .replace('{0}', translatedMessage(diagnostic[1], locale))
      .replace('{1}', translatedMessage(diagnostic[2], locale));
  const parts = key.split(/(?<=。)\s*/).filter(Boolean);
  if (parts.length > 1) return parts.map((part) => translatedMessage(part, locale)).join(' ');
  return key;
}
/** Translate UI copy only. Captions, drafts, provider names and API parameters remain untouched. */
export function t(key: string | undefined, ...values: (string | number)[]): string {
  if (key === undefined) return '';
  const message = language === 'zh-CN' ? key : translatedMessage(key, language);
  return message.replace(/\{(\d+)\}/g, (match, index) => String(values[Number(index)] ?? match));
}
