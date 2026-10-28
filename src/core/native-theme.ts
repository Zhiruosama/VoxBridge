/** Endpoint-only native preferences. Visible Mac chrome is painted by the WebView. */
export async function syncNativeTheme(
  window: {
    setTheme: (theme: 'light' | 'dark' | null) => Promise<void>;
    setBackgroundColor: (color: string) => Promise<void>;
  },
  options: { theme: 'light' | 'dark' | 'system'; resolved: 'light' | 'dark'; signal: AbortSignal },
) {
  if (options.signal.aborted) return;
  await window.setTheme(options.theme === 'system' ? null : options.resolved);
  if (options.signal.aborted) return;
  await window.setBackgroundColor(options.resolved === 'light' ? '#f0f0ee' : '#181818');
}
