// Runs before the main bundle and fonts, including when loading them fails.
(() => {
  const root = document.documentElement;
  if (new URLSearchParams(location.search).get('window') === 'subtitle') {
    root.dataset.overlay = 'true';
    return;
  }
  let settings;
  try {
    settings = JSON.parse(localStorage.getItem('voxbridge.settings.v1') || '{}');
  } catch {
    // The application reports unreadable settings after mounting.
  }
  const theme = settings?.theme;
  root.dataset.theme =
    theme === 'light' || (theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches)
      ? 'light'
      : 'dark';
  root.dataset.language = settings?.uiLanguage === 'en' ? 'en' : 'zh-CN';
  root.lang = root.dataset.language;
  setTimeout(() => {
    const caption = document.getElementById('startup-caption');
    const retry = document.getElementById('startup-retry');
    // React replaces the startup content on its first successful commit.
    if (!caption || !retry) return;
    caption.textContent =
      root.dataset.language === 'en'
        ? 'Startup is taking longer than expected. Try reloading.'
        : '启动时间较长，请尝试重新加载。';
    retry.hidden = false;
    retry.addEventListener('click', () => location.reload());
  }, 12000);
})();
