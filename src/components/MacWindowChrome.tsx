/** AppKit still owns the traffic lights; the WebView paints their background. */
export default function MacWindowChrome() {
  return (
    <header className="mac-window-chrome" data-tauri-drag-region>
      <span data-tauri-drag-region>VoxBridge</span>
    </header>
  );
}
