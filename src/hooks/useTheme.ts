import { getCurrentWindow } from '@tauri-apps/api/window';
import { recordDiagnostic } from '../diagnostics';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Settings } from '../core/types';
import { fadeThemeSnapshot } from '../core/theme-snapshot';

export function useTheme(theme: Settings['theme'], nativeMacFrame = false) {
  const frameUpdates = useRef(Promise.resolve());
  const frameRevision = useRef(0);
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
      const update = () => {
        if (revision !== frameRevision.current) return;
        root.dataset.theme = next;
        if (nativeMacFrame) {
          // Native chrome cannot join a DOM snapshot transition. Apply it alongside
          // the new surface and skip queued intermediate themes on rapid toggles.
          frameUpdates.current = frameUpdates.current
            .then(async () => {
              if (revision !== frameRevision.current) return;
              const window = getCurrentWindow();
              await window.setTheme(theme === 'system' ? null : next);
              if (revision !== frameRevision.current) return;
              await window.setBackgroundColor(next === 'light' ? '#f0f0ee' : '#181818');
            })
            .catch(() => console.warn('Unable to synchronize the native window theme.'));
        }
      };
      if (root.dataset.theme === next) {
        update();
        return;
      }
      const animate =
        root.dataset.theme !== undefined && !matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (animate && typeof document.startViewTransition === 'function') {
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
      transition.current?.skipTransition();
      clearSnapshot.current?.();
    },
    [],
  );
}
