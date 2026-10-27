/** Match the DOM surface crossfade without replacing the native Mac title bar. */
export type ChromeColor = readonly [number, number, number];
const chromeColors: Record<'light' | 'dark', ChromeColor> = {
  light: [240, 240, 238],
  dark: [24, 24, 24],
};
export const themeFadeDuration = 400;
function frame(signal: AbortSignal): Promise<number | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const cancel = () => {
      cancelAnimationFrame(id);
      resolve(null);
    };
    const id = requestAnimationFrame((time) => {
      signal.removeEventListener('abort', cancel);
      resolve(time);
    });
    signal.addEventListener('abort', cancel, { once: true });
  });
}

export async function syncNativeTheme(
  window: {
    setTheme: (theme: 'light' | 'dark' | null) => Promise<void>;
    setBackgroundColor: (color: string) => Promise<void>;
  },
  options: {
    theme: 'light' | 'dark' | 'system';
    resolved: 'light' | 'dark';
    from: ChromeColor | null;
    animate: boolean;
    signal: AbortSignal;
    onColor: (color: ChromeColor) => void;
  },
) {
  const { signal, from, onColor } = options;
  const target = chromeColors[options.resolved];
  const appearance = options.theme === 'system' ? null : options.resolved;
  const color = async (rgb: ChromeColor) => {
    await window.setBackgroundColor(`#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`);
    // Even if aborted during IPC, remember the actual applied color. The next
    // queued transition starts here rather than jumping to a stale endpoint.
    onColor(rgb);
  };
  if (signal.aborted) return;
  if (!options.animate || !from || target.every((value, index) => value === from[index])) {
    await window.setTheme(appearance);
    if (!signal.aborted) await color(target);
    return;
  }
  const started = performance.now();
  let appearanceApplied = false;
  while (!signal.aborted) {
    const time = await frame(signal);
    if (time === null || signal.aborted) return;
    const progress = Math.max(0, Math.min(1, (time - started) / themeFadeDuration));
    // Switch native text contrast near the middle, when the surface is neutral.
    if (!appearanceApplied && progress >= 0.5) {
      await window.setTheme(appearance);
      appearanceApplied = true;
      if (signal.aborted) return;
    }
    const eased = progress * progress * (3 - 2 * progress);
    const mix = (index: number) => Math.round(from[index] + (target[index] - from[index]) * eased);
    await color([mix(0), mix(1), mix(2)]);
    if (progress === 1) return;
  }
}
