import { useSyncExternalStore } from 'react';
import english from './en.json';

export type UiLanguage = 'zh-CN' | 'en';
const catalog: Record<string, string> = english;
const listeners = new Set<() => void>();
export function parseUiLanguage(value: unknown): UiLanguage {
  return value === 'en' ? 'en' : 'zh-CN';
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
function englishMessage(key: string): string {
  if (Object.hasOwn(catalog, key)) return catalog[key];
  if (key.startsWith('Error: ')) return `Error: ${englishMessage(key.slice(7))}`;
  const diagnostic = /^目标：(.+)；返回语言识别：(.+)$/.exec(key);
  if (diagnostic)
    return `Target: ${englishMessage(diagnostic[1])}; detected language: ${englishMessage(diagnostic[2])}`;
  const parts = key.split(/(?<=。)\s*/).filter(Boolean);
  if (parts.length > 1) return parts.map(englishMessage).join(' ');
  return key;
}
/** Translate UI copy only. Captions, drafts, provider names and API parameters remain untouched. */
export function t(key: string | undefined, ...values: (string | number)[]): string {
  if (key === undefined) return '';
  const message = language === 'en' ? englishMessage(key) : key;
  return message.replace(/\{(\d+)\}/g, (match, index) => String(values[Number(index)] ?? match));
}
