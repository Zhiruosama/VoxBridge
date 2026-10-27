import { getCurrentWindow } from '@tauri-apps/api/window';
import { recordDiagnostic } from '../diagnostics';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Settings } from '../core/types';
import { fadeThemeSnapshot } from '../core/theme-snapshot';
import { syncNativeTheme, type ChromeColor } from '../core/native-theme';
import { ThemeSurface } from '../core/theme-surface';

export function useTheme(theme: Settings['theme'], nativeMacFrame = false) {
  const frameUpdates = useRef(Promise.resolve());
  const frameRevision = useRef(0);
  const frameColor = useRef<ChromeColor | null>(null);
  const frameAbort = useRef<AbortController | null>(null);
  const surface = useRef<ThemeSurface | null>(null);
  const transition = useRef<ViewTransition | null>(null);
  const clearSnapshot = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-color-scheme: light)');
    function apply() {
      const root = document.documentElement;
      const next = theme === 'system' ? (media.matches ? 'light' : 'dark') : theme;
      // Finish pending snapshot callbacks before starting another theme change.
      // Revision checks prevent skipped callbacks from restoring an older theme.
      transition.current?.skipTransition();
      transition.current = null;
      clearSnapshot.current?.();
      clearSnapshot.current = null;
      const revision = ++frameRevision.current;
      frameAbort.current?.abort();
      const abort = new AbortController();
      frameAbort.current = abort;
      const animate =
        root.dataset.theme !== undefined &&
        root.dataset.theme !== next &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches;
      const update = () => {
        if (revision !== frameRevision.current) return;
        const paint =
          nativeMacFrame && animate
            ? (surface.current ??= new ThemeSurface(root)).prepare(next)
            : null;
        if (!paint) {
          surface.current?.finish();
          root.dataset.theme = next;
        }
        if (nativeMacFrame) {
          // Serialize native calls, but cancel obsolete fades immediately. The
          // retained color lets rapid toggles continue from the visible shade.
          frameUpdates.current = frameUpdates.current
            .then(async () => {
              if (revision !== frameRevision.current) return;
              await syncNativeTheme(getCurrentWindow(), {
                theme,
                resolved: next,
                from: frameColor.current,
                animate,
                signal: abort.signal,
                onProgress: (progress) => {
                  if (revision === frameRevision.current) paint?.(progress);
                },
                onColor: (color) => {
                  frameColor.current = color;
                },
              });
              if (revision === frameRevision.current) surface.current?.finish();
            })
            .catch(() => {
              if (revision === frameRevision.current) surface.current?.finish();
              console.warn('Unable to synchronize the native window theme.');
            });
        }
      };
      if (root.dataset.theme === next) {
        update();
        return;
      }
      if (nativeMacFrame) {
        // A single native-driven progress updates every DOM surface too. Keeping
        // separate snapshot and chrome fades produces a visibly layered seam.
        update();
      } else if (animate && typeof document.startViewTransition === 'function') {
        // Blend two complete, readable frames instead of interpolating foreground
        // and background through the same grey (which makes text appear to blink).
        const current = document.startViewTransition(update);
        transition.current = current;
        void current.finished
          .catch(() => {})
          .finally(() => {
            if (transition.current === current) transition.current = null;
          });
      } else {
        const source = animate ? document.getElementById('root') : null;
        if (source) clearSnapshot.current = fadeThemeSnapshot(source, update);
        else update();
      }
      recordDiagnostic({
        operation: 'frontend',
        kind: 'state',
        phase: next === 'light' ? 'theme_light' : 'theme_dark',
      });
    }
    apply();
    // macOS setTheme() can also change the WebView's media query. Explicit
    // light/dark choices must not treat that notification as a new toggle and
    // cancel their own in-progress animation. Ignore redundant system events too.
    function systemChanged() {
      const next = media.matches ? 'light' : 'dark';
      if (document.documentElement.dataset.theme !== next) apply();
    }
    if (theme === 'system') media.addEventListener('change', systemChanged);
    return () => media.removeEventListener('change', systemChanged);
  }, [theme, nativeMacFrame]);
  useEffect(
    () => () => {
      ++frameRevision.current;
      frameAbort.current?.abort();
      surface.current?.finish();
      transition.current?.skipTransition();
      clearSnapshot.current?.();
    },
    [],
  );
}
