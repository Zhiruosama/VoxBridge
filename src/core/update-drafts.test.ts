import { expect, it, vi } from 'vitest';
import { clearUpdateDrafts, readUpdateDrafts, saveUpdateDrafts } from './update-drafts';
import { TextTranslationController } from './text-translation';

const draft = {
  main: 'Next message',
  overlay: '浮窗草稿',
  translation: {
    input: '你好',
    source: '自动识别',
    target: '英语',
    result: 'Hello',
    resultTarget: '英语',
  },
};
function storage() {
  let value: string | null = null;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
    removeItem: vi.fn(() => {
      value = null;
    }),
  };
}
it('retains all three inputs and the last translation across the update restart, without audio or credentials', () => {
  const store = storage();
  saveUpdateDrafts(draft, store);
  expect(readUpdateDrafts(store)).toEqual(draft);
  // Reading is side-effect-free, including React StrictMode initialization.
  expect(readUpdateDrafts(store)).toEqual(draft);
  const deps = { translate: vi.fn(), cancelTranslation: vi.fn() };
  const controller = new TextTranslationController(
    deps,
    '日语',
    readUpdateDrafts(store)!.translation,
  );
  expect(controller.getSnapshot()).toMatchObject({ ...draft.translation, busy: false, error: '' });
  expect(deps.translate).not.toHaveBeenCalled();
  clearUpdateDrafts(store);
  expect(readUpdateDrafts(store)).toBeNull();
});
it('rejects expired, malformed and oversized update drafts without preventing startup', () => {
  const store = storage();
  for (const raw of [
    '{',
    JSON.stringify({ schema: 1, at: Date.now() - 86400001, ...draft }),
    JSON.stringify({ schema: 1, at: Date.now(), ...draft, main: 123 }),
    'x'.repeat(150001),
  ]) {
    store.setItem('', raw);
    expect(readUpdateDrafts(store)).toBeNull();
  }
  expect(
    readUpdateDrafts({
      ...store,
      getItem: () => {
        throw Error('denied');
      },
    }),
  ).toBeNull();
});
it('reports storage failure to the update controller instead of silently losing text', () => {
  expect(() =>
    saveUpdateDrafts(draft, {
      ...storage(),
      setItem: () => {
        throw Error('quota');
      },
    }),
  ).toThrow('quota');
});

it('refuses an oversized backup before installation instead of writing unrecoverable data', () => {
  const store = storage();
  expect(() => saveUpdateDrafts({ ...draft, main: 'x'.repeat(150001) }, store)).toThrow();
  expect(store.setItem).not.toHaveBeenCalled();
});
