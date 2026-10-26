import { getCurrentWindow } from '@tauri-apps/api/window';
import { recordDiagnostic } from '../diagnostics';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Settings } from '../core/types';

export function useTheme(theme: Settings['theme'], nativeMacFrame = false) {
  const frameUpdates = useRef(Promise.resolve());
  const frameRevision = useRef(0);
  const transition = useRef<ViewTransition | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshot = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-color-scheme: light)');
    function apply() {
      const root = document.documentElement;
      const next = theme === 'system' ? (media.matches ? 'light' : 'dark') : theme;
      // Finish pending snapshot callbacks before starting another theme change.
      // Revision checks prevent skipped callbacks from restoring an older theme.
      transition.current?.skipTransition();
      transition.current = null;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      snapshot.current?.remove();
      snapshot.current = null;
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
        if (animate) {
          // Older WKWebView has no View Transition API. Freeze the old DOM in
          // a non-interactive, accessibility-hidden layer; only its opacity
          // animates, so foreground and background always retain their contrast.
          const source = document.getElementById('root');
          if (source) {
            const layer = source.cloneNode(true) as HTMLElement;
            const style = getComputedStyle(root);
            for (const property of Array.from(style)) {
              if (property.startsWith('--'))
                layer.style.setProperty(property, style.getPropertyValue(property));
            }
            layer.style.color = style.color;
            layer.style.colorScheme = next === 'light' ? 'dark' : 'light';
            layer.removeAttribute('id');
            layer.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
            layer.inert = true;
            layer.setAttribute('aria-hidden', 'true');
            layer.className = 'theme-snapshot';
            const originals = source.querySelectorAll('*');
            const copies = layer.querySelectorAll('*');
            document.body.append(layer);
            originals.forEach((element, index) => {
              copies[index].scrollTop = element.scrollTop;
              copies[index].scrollLeft = element.scrollLeft;
            });
            snapshot.current = layer;
            timer.current = setTimeout(() => {
              layer.remove();
              if (snapshot.current === layer) snapshot.current = null;
              timer.current = null;
            }, 440);
          }
        }
        update();
      }
      recordDiagnostic({
        operation: 'frontend',
        kind: 'state',
        phase: next === 'light' ? 'theme_light' : 'theme_dark',
      });
    }
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, nativeMacFrame]);
  useEffect(
    () => () => {
      ++frameRevision.current;
      transition.current?.skipTransition();
      if (timer.current !== null) clearTimeout(timer.current);
      snapshot.current?.remove();
    },
    [],
  );
}
