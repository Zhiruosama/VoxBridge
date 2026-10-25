import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AudioLines, Copy, Minus, PanelLeftClose, PanelLeftOpen, Square, X } from 'lucide-react';
import { t } from '../i18n';

/** Windows-only window chrome. macOS keeps its native frame and traffic lights. */
export default function WindowChrome({
  sidebar,
  onToggleSidebar,
  notify,
}: {
  sidebar: boolean;
  onToggleSidebar: () => void;
  notify: (message: string) => void;
}) {
  const [appWindow] = useState(() => getCurrentWindow());
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    async function sync() {
      try {
        const next = await appWindow.isMaximized();
        if (active) setMaximized(next);
      } catch {
        if (active) notify(t('无法读取窗口状态，请重启应用。'));
      }
    }
    void sync();
    void appWindow
      .onResized(sync)
      .then((off) => {
        if (active) unsubscribe = off;
        else off();
      })
      .catch(() => {
        if (active) notify(t('无法读取窗口状态，请重启应用。'));
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [appWindow, notify]);

  async function control(action: 'minimize' | 'maximize' | 'close') {
    try {
      if (action === 'minimize') await appWindow.minimize();
      else if (action === 'close') await appWindow.close();
      else {
        await appWindow.toggleMaximize();
        setMaximized(await appWindow.isMaximized());
      }
    } catch {
      notify(t('无法操作窗口，请重试。'));
    }
  }
  return (
    <header className="window-chrome" data-tauri-drag-region>
      <div className="window-chrome-leading" data-tauri-drag-region>
        <button
          className="window-sidebar-toggle"
          type="button"
          aria-label={t(sidebar ? '收起侧栏' : '展开侧栏')}
          title={t(sidebar ? '收起侧栏' : '展开侧栏')}
          aria-expanded={sidebar}
          onClick={onToggleSidebar}
        >
          {sidebar ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <span className="window-chrome-brand" data-tauri-drag-region>
          <AudioLines size={15} aria-hidden="true" />
          VoxBridge
        </span>
      </div>
      <div className="window-chrome-drag" data-tauri-drag-region />
      <div className="window-controls" role="group" aria-label={t('窗口控制')}>
        <button
          type="button"
          aria-label={t('最小化')}
          title={t('最小化')}
          onClick={() => void control('minimize')}
        >
          <Minus size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t(maximized ? '还原窗口' : '最大化')}
          title={t(maximized ? '还原窗口' : '最大化')}
          onClick={() => void control('maximize')}
        >
          {maximized ? (
            <Copy size={13} aria-hidden="true" />
          ) : (
            <Square size={13} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="window-close"
          aria-label={t('关闭窗口')}
          title={t('关闭窗口')}
          onClick={() => void control('close')}
        >
          <X size={17} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
