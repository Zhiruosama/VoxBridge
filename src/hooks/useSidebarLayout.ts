import { useEffect, useRef, useState } from 'react';
import {
  sidebarDefault,
  sidebarLimit,
  sidebarStorageKey,
  sidebarWidth,
} from '../core/sidebar-layout';

export function useSidebarLayout() {
  const shellRef = useRef<HTMLDivElement>(null);
  const [preferred, setPreferred] = useState(() => {
    try {
      return sidebarWidth(JSON.parse(localStorage.getItem(sidebarStorageKey) ?? 'null'));
    } catch {
      return sidebarDefault;
    }
  });
  const [maximum, setMaximum] = useState(() => sidebarLimit(window.innerWidth));
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(() => setMaximum(sidebarLimit(shell.clientWidth)));
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);
  function setWidth(value: number, persist = true) {
    const next = sidebarWidth(value, maximum);
    setPreferred(next);
    if (persist) {
      try {
        localStorage.setItem(sidebarStorageKey, JSON.stringify(next));
      } catch {
        // Layout remains usable when local storage is unavailable.
      }
    }
  }
  return { shellRef, width: sidebarWidth(preferred, maximum), maximum, setWidth };
}
