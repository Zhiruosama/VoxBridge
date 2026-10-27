// Isolated fixture: no App, settings, credentials, clipboard or model services.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTheme } from '../../src/hooks/useTheme';
import '../../src/styles.css';
function ThemeProbe() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useTheme(theme, true);
  useEffect(() => {
    const timers = [
      setTimeout(() => setTheme('light'), 600),
      setTimeout(() => setTheme('dark'), 1300),
      setTimeout(() => setTheme('light'), 2000),
      setTimeout(() => setTheme('dark'), 2110),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  return <main>Native title bar theme regression</main>;
}
createRoot(document.getElementById('root')!).render(<ThemeProbe />);
