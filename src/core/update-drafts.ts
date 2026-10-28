import type { TextTranslationState } from './text-translation';

export type TranslationDraft = Pick<
  TextTranslationState,
  'input' | 'source' | 'target' | 'result' | 'resultTarget'
>;
export type UpdateDrafts = { main: string; overlay: string; translation: TranslationDraft };
const key = 'voxbridge.update-drafts.v1';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function clearUpdateDrafts(store: Store = localStorage) {
  store.removeItem(key);
}
export function saveUpdateDrafts(drafts: UpdateDrafts, store: Store = localStorage) {
  const raw = JSON.stringify({ schema: 1, at: Date.now(), ...drafts });
  if (raw.length > 150000) throw Error('Update drafts exceed the storage limit.');
  store.setItem(key, raw);
}
/** One restart only, bounded and local. Never includes profiles, keys or audio. */
export function readUpdateDrafts(store: Store = localStorage): UpdateDrafts | null {
  try {
    const raw = store.getItem(key);
    if (!raw || raw.length > 150000) return null;
    const data = JSON.parse(raw);
    if (data.schema !== 1 || !Number.isFinite(data.at) || Math.abs(Date.now() - data.at) > 86400000)
      return null;
    const text = (value: unknown) => typeof value === 'string' && value.length <= 150000;
    const draft = data.translation;
    if (
      !text(data.main) ||
      !text(data.overlay) ||
      !draft ||
      !['input', 'source', 'target', 'result', 'resultTarget'].every((name) => text(draft[name]))
    )
      return null;
    return {
      main: data.main,
      overlay: data.overlay,
      translation: {
        input: draft.input,
        source: draft.source,
        target: draft.target,
        result: draft.result,
        resultTarget: draft.resultTarget,
      },
    };
  } catch {
    return null;
  }
}
