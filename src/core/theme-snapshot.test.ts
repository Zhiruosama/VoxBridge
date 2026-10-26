import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fadeThemeSnapshot } from './theme-snapshot';

function surface() {
  const operations: string[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const editor = { tagName: 'TEXTAREA', value: 'unsaved draft' };
  const editorCopy = { value: '' };
  const original = {
    get scrollLeft() {
      operations.push('read');
      return 12;
    },
    get scrollTop() {
      operations.push('read');
      return 240;
    },
  };
  const copy = { scrollLeft: 0, scrollTop: 0 };
  const listeners = new Map<string, (event: { target: unknown }) => void>();
  const layer = {
    style: { setProperty: vi.fn(), color: '', colorScheme: '' },
    classList: { add: vi.fn() },
    dataset: {} as Record<string, string>,
    inert: false,
    removeAttribute: vi.fn(),
    setAttribute: vi.fn(),
    remove: vi.fn(),
    querySelectorAll: (query: string) =>
      query === '*' ? [copy] : query === '[id]' ? [] : [editorCopy],
    addEventListener: (name: string, callback: (event: { target: unknown }) => void) =>
      listeners.set(name, callback),
  };
  const source = {
    cloneNode: () => layer,
    querySelectorAll: (query: string) => (query === '*' ? [original] : [editor]),
  } as unknown as HTMLElement;
  const root = { dataset: { theme: 'light' } };
  vi.stubGlobal('document', {
    documentElement: root,
    body: { append: () => operations.push('append') },
  });
  const style = Object.assign(['--bg', '--text'], {
    color: '#242426',
    getPropertyValue: (property: string) => (property === '--bg' ? '#fafaf9' : '#242426'),
  });
  vi.stubGlobal('getComputedStyle', () => style);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  function paint() {
    const pending = [...frames];
    frames.clear();
    for (const [, callback] of pending) callback(0);
  }
  return { source, layer, root, paint, operations, editorCopy, copy, listeners, frames };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('paints the old frame before committing, preserving drafts, scroll and old theme colors', () => {
  const state = surface();
  const commit = vi.fn(() => {
    state.root.dataset.theme = 'dark';
  });
  fadeThemeSnapshot(state.source, commit);
  expect(state.operations).toEqual(['read', 'read', 'append']);
  expect(state.copy).toEqual({ scrollLeft: 12, scrollTop: 240 });
  expect(state.editorCopy.value).toBe('unsaved draft');
  expect(state.layer.style.colorScheme).toBe('light');
  expect(state.layer.inert).toBe(true);
  // Slow cloning/painting must not consume the animation's cleanup budget.
  vi.advanceTimersByTime(1000);
  expect(state.layer.remove).not.toHaveBeenCalled();
  state.paint();
  expect(commit).not.toHaveBeenCalled();
  state.paint();
  expect(commit).toHaveBeenCalledOnce();
  expect(state.layer.dataset.playing).toBe('true');
  state.listeners.get('animationend')!({ target: {} });
  expect(state.layer.remove).not.toHaveBeenCalled();
  vi.advanceTimersByTime(440);
  expect(state.layer.remove).toHaveBeenCalledOnce();
});

it('cancels pending frames so an old toggle cannot overwrite the newest theme', () => {
  const state = surface();
  const commit = vi.fn();
  const cancel = fadeThemeSnapshot(state.source, commit);
  state.paint();
  cancel();
  state.paint();
  expect(commit).not.toHaveBeenCalled();
  expect(state.frames.size).toBe(0);
  expect(state.layer.remove).toHaveBeenCalledOnce();
});
