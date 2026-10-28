import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';

/** AppKit keeps the traffic lights; the WebView paints the shared titlebar. */
export default function MacWindowChrome() {
  return (
    <header
      className="mac-window-chrome"
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        if (event.detail === 2) void invoke('zoom_main_window').catch(() => {});
        else if (event.detail === 1)
          void getCurrentWindow()
            .startDragging()
            .catch(() => {});
      }}
    >
      <span>VoxBridge</span>
    </header>
  );
}
