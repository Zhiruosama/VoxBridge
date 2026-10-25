import { recordDiagnostic } from '../diagnostics';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Settings } from '../core/types';

export function useTheme(theme: Settings['theme']) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-color-scheme: light)');
    function apply() {
      const root = document.documentElement;
      const next = theme === 'system' ? (media.matches ? 'light' : 'dark') : theme;
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
  }, [theme]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      document.documentElement.removeAttribute('data-theme-changing');
    },
    [],
  );
}
