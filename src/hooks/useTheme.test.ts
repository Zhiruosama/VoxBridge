import { afterEach, expect, it, vi } from 'vitest';
import { useTheme } from './useTheme';

const state = vi.hoisted(() => ({
  cleanup: [] as (() => void)[],
  window: { setTheme: vi.fn(), setBackgroundColor: vi.fn() },
}));
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useLayoutEffect: (effect: () => (() => void) | undefined) => {
    const cleanup = effect();
    if (cleanup) state.cleanup.push(cleanup);
  },
  useEffect: (effect: () => (() => void) | undefined) => {
    const cleanup = effect();
    if (cleanup) state.cleanup.push(cleanup);
  },
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => state.window }));
vi.mock('../diagnostics', () => ({ recordDiagnostic: vi.fn() }));

function environment(matches: boolean, initial = 'dark') {
  const listeners = new Set<() => void>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now() + 400), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  const media = {
    matches,
    addEventListener: (_: string, callback: () => void) => listeners.add(callback),
    removeEventListener: (_: string, callback: () => void) => listeners.delete(callback),
  };
  const transition = { skipTransition: vi.fn(), finished: new Promise(() => {}) };
  const root = { dataset: { theme: initial } };
  const start = vi.fn((update: () => void) => {
    update();
    return transition;
  });
  vi.stubGlobal('document', { documentElement: root, startViewTransition: start });
  vi.stubGlobal('matchMedia', (query: string) =>
    query.includes('reduced-motion') ? { matches: false } : media,
  );
  state.window.setTheme.mockImplementation(async () => {
    // Model WKWebView notifying prefers-color-scheme after native frame sync.
    for (const callback of listeners) callback();
  });
  state.window.setBackgroundColor.mockResolvedValue(undefined);
  return { listeners, media, transition, root, start };
}

afterEach(() => {
  state.cleanup.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('does not let a native Mac theme notification cancel an explicit theme animation', async () => {
  const surface = environment(true);
  useTheme('light', true);
  await vi.waitFor(() => expect(state.window.setBackgroundColor).toHaveBeenCalledOnce());
  expect(surface.root.dataset.theme).toBe('light');
  expect(surface.start).toHaveBeenCalledOnce();
  expect(surface.listeners.size).toBe(0);
  expect(surface.transition.skipTransition).not.toHaveBeenCalled();
  expect(state.window.setTheme).toHaveBeenCalledExactlyOnceWith('light');
});

it('follows real system changes and ignores redundant notifications during a transition', async () => {
  const surface = environment(true);
  useTheme('system', true);
  await vi.waitFor(() => expect(state.window.setBackgroundColor).toHaveBeenCalledOnce());
  expect(surface.listeners.size).toBe(1);
  expect(surface.start).toHaveBeenCalledOnce();
  expect(surface.transition.skipTransition).not.toHaveBeenCalled();
  surface.media.matches = false;
  surface.listeners.forEach((callback) => callback());
  expect(surface.root.dataset.theme).toBe('dark');
  expect(surface.start).toHaveBeenCalledTimes(2);
});

it('keeps the DOM snapshot transition on Windows without native calls', () => {
  const surface = environment(true);
  useTheme('light', false);
  expect(surface.start).toHaveBeenCalledOnce();
  expect(state.window.setTheme).not.toHaveBeenCalled();
  expect(state.window.setBackgroundColor).not.toHaveBeenCalled();
});
