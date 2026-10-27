import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const script = readFileSync(new URL('../../public/startup.js', import.meta.url), 'utf8');
function boot({
  reduced = false,
  subtitle = false,
  textOverlay = false,
  brokenSettings = false,
} = {}) {
  const frames = [];
  const events = new EventTarget();
  const listeners = new Map();
  const splash = {
    remove: vi.fn(),
    setAttribute: vi.fn(),
    inert: false,
    classList: { add: vi.fn() },
    addEventListener: (name, callback) => listeners.set(name, callback),
  };
  const caption = { textContent: '' };
  const retry = { hidden: true, addEventListener: vi.fn() };
  const root = { dataset: {}, lang: '' };
  const elements = {
    'startup-screen': splash,
    'startup-caption': caption,
    'startup-retry': retry,
  };
  runInNewContext(script, {
    document: { documentElement: root, getElementById: (id) => elements[id] },
    window: events,
    location: {
      search: subtitle ? '?window=subtitle' : textOverlay ? '?window=text-overlay' : '',
      reload: vi.fn(),
    },
    localStorage: {
      getItem: () => {
        if (brokenSettings) throw new Error('Unavailable');
        return '{"theme":"light","uiLanguage":"en"}';
      },
    },
    matchMedia: (query) => ({ matches: query.includes('reduced-motion') && reduced }),
    requestAnimationFrame: (callback) => frames.push(callback),
    setTimeout,
    clearTimeout,
    URLSearchParams,
  });
  return { splash, caption, retry, root, frames, events, listeners };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('startup handoff', () => {
  it('paints the committed UI before fading and ignores bubbling wave animation events', () => {
    const state = boot();
    state.events.dispatchEvent(new Event('voxbridge:ready'));
    state.events.dispatchEvent(new Event('voxbridge:ready'));
    expect(state.frames).toHaveLength(1);
    expect(state.splash.inert).toBe(true);
    expect(state.splash.classList.add).not.toHaveBeenCalled();
    state.frames.shift()();
    expect(state.splash.classList.add).not.toHaveBeenCalled();
    state.frames.shift()();
    expect(state.splash.classList.add).toHaveBeenCalledWith('startup-leaving');
    state.listeners.get('animationend')({ target: {} });
    expect(state.splash.remove).not.toHaveBeenCalled();
    state.listeners.get('animationend')({ target: state.splash });
    expect(state.splash.remove).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(12000);
    expect(state.retry.hidden).toBe(true);
  });

  it('removes the layer even when no animationend event arrives', () => {
    const state = boot();
    state.events.dispatchEvent(new Event('voxbridge:ready'));
    state.frames.shift()();
    state.frames.shift()();
    vi.advanceTimersByTime(600);
    expect(state.splash.remove).toHaveBeenCalledOnce();
  });

  it('keeps the recovery action available when the application never commits', () => {
    const state = boot();
    vi.advanceTimersByTime(12000);
    expect(state.retry.hidden).toBe(false);
    expect(state.caption.textContent).toContain('Try reloading');
    expect(state.splash.remove).not.toHaveBeenCalled();
  });

  it('skips animation when reduced motion is requested', () => {
    const state = boot({ reduced: true });
    state.events.dispatchEvent(new Event('voxbridge:ready'));
    expect(state.splash.remove).toHaveBeenCalledOnce();
    expect(state.frames).toHaveLength(0);
  });

  it('leaves the subtitle window transparent and tolerates unreadable settings', () => {
    const subtitle = boot({ subtitle: true });
    expect(subtitle.root.dataset.overlay).toBe('true');
    expect(vi.getTimerCount()).toBe(0);
    expect(boot({ textOverlay: true }).root.dataset.overlay).toBe('true');
    expect(vi.getTimerCount()).toBe(0);
    const main = boot({ brokenSettings: true });
    expect(main.root.dataset.theme).toBe('dark');
    main.events.dispatchEvent(new Event('voxbridge:ready'));
    expect(main.frames).toHaveLength(1);
  });
});
