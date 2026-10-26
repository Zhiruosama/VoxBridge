import { getCurrentWindow } from '@tauri-apps/api/window';
import { recordDiagnostic } from '../diagnostics';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Settings } from '../core/types';

export function useTheme(theme: Settings['theme'], nativeMacFrame = false) {
  const frameUpdates = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-color-scheme: light)');
    function apply() {
      const root = document.documentElement;
      const next = theme === 'system' ? (media.matches ? 'light' : 'dark') : theme;
      if (nativeMacFrame) {
        // Serialize changes so a rapid theme toggle cannot leave an older native
        // background behind the latest webview theme. Keep the title bar opaque
        // and use the same surface color as the sidebar.
        frameUpdates.current = frameUpdates.current
          .then(async () => {
            const window = getCurrentWindow();
            await window.setTheme(theme === 'system' ? null : next);
            await window.setBackgroundColor(next === 'light' ? '#f0f0ee' : '#181818');
          })
          .catch(() => console.warn('Unable to synchronize the native window theme.'));
      }
      if (root.dataset.theme === next) return;
      if (timer.current !== null) clearTimeout(timer.current);
      const animate =
        root.dataset.theme !== undefined && !matchMedia('(prefers-reduced-motion: reduce)').matches;
      root.toggleAttribute('data-theme-changing', animate);
      root.dataset.theme = next;
      recordDiagnostic({
        operation: 'frontend',
        kind: 'state',
        phase: next === 'light' ? 'theme_light' : 'theme_dark',
      });
      timer.current = animate
        ? setTimeout(() => {
            root.removeAttribute('data-theme-changing');
            timer.current = null;
          }, 360)
        : null;
    }
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, nativeMacFrame]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      document.documentElement.removeAttribute('data-theme-changing');
    },
    [],
  );
}
