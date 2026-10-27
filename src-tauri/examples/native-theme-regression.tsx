// Isolated fixture: no App, settings, credentials, clipboard or model services.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { emit } from '@tauri-apps/api/event';
import { useTheme } from '../../src/hooks/useTheme';
import '../../src/styles.css';
function ThemeProbe() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useTheme(theme, true);
  useEffect(() => {
    const swatch = document.getElementById('theme-probe-side')!;
    const observer = new MutationObserver(() => {
      const rgb = (getComputedStyle(swatch).backgroundColor.match(/\d+/g) ?? [])
        .slice(0, 3)
        .map(Number);
      const text = (getComputedStyle(swatch).color.match(/\d+/g) ?? []).slice(0, 3).map(Number);
      void emit('theme-probe-color', {
        rgb,
        text,
        snapshots: document.querySelectorAll('.theme-snapshot').length,
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme'],
    });
    const timers = [
      setTimeout(() => setTheme('light'), 600),
      setTimeout(() => setTheme('dark'), 1300),
      setTimeout(() => setTheme('light'), 2000),
      setTimeout(() => setTheme('dark'), 2110),
    ];
    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);
  return (
    <main
      id="theme-probe-side"
      style={{ background: 'var(--side)', color: 'var(--text)', height: '100vh', padding: 24 }}
    >
      <h1>Native title bar theme regression</h1>
      <p>Surfaces share one animation clock. Text keeps its contrast.</p>
      <input defaultValue="Unsaved draft" />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<ThemeProbe />);
