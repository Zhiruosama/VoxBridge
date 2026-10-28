// Isolated fixture: no App, settings, credentials, clipboard or model services.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { emit } from '@tauri-apps/api/event';
import { useTheme } from '../../src/hooks/useTheme';
import MacWindowChrome from '../../src/components/MacWindowChrome';
import '../../src/styles.css';
function ThemeProbe() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useTheme(theme, true);
  useEffect(() => {
    let frame = 0;
    const sample = () => {
      const header = document.querySelector('.mac-window-chrome')!;
      const body = document.getElementById('theme-probe-side')!;
      const headerStyle = getComputedStyle(header);
      const bodyStyle = getComputedStyle(body);
      void emit('theme-probe-color', {
        header: headerStyle.backgroundColor,
        body: bodyStyle.backgroundColor,
        text: headerStyle.color === bodyStyle.color,
        width: header.getBoundingClientRect().width,
        height: header.getBoundingClientRect().height,
        viewport: innerWidth,
        // No per-token inline interpolation may leave controls on another palette.
        inlineTokens: document.documentElement.style.getPropertyValue('--side'),
      });
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    const timers = [
      setTimeout(() => setTheme('light'), 2000),
      setTimeout(() => setTheme('dark'), 4000),
      setTimeout(() => setTheme('light'), 6000),
      setTimeout(() => setTheme('dark'), 6110),
    ];
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
    };
  }, []);
  return (
    <div
      className="app-shell has-mac-chrome"
      style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '0 8px 8px' }}
    >
      <MacWindowChrome />
      <main
        id="theme-probe-side"
        style={{ background: 'var(--side)', color: 'var(--muted)', flex: 1, padding: 24 }}
      >
        <h1 style={{ color: 'var(--text)' }}>Mac theme transition</h1>
        <p>The header and page belong to the same transition.</p>
        <input defaultValue="Unsaved draft" />
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>Toggle theme</button>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<ThemeProbe />);
