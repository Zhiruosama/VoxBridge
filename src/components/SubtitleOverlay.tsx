import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { focusMain, readOverlay, stopOverlayListening } from '../bridge';
import { newerOverlay, subtitleDefaults } from '../core/overlay';
import type { OverlaySnapshot } from '../core/types';

export default function SubtitleOverlay() {
  const [snapshot, setSnapshot] = useState<OverlaySnapshot>({
    version: 0,
    sessionId: null,
    phase: 'idle',
    lines: [],
    ...subtitleDefaults,
  });
  const [error, setError] = useState('');
  useEffect(() => {
    document.documentElement.dataset.overlay = 'true';
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    async function initialize() {
      const unlisten = await listen<OverlaySnapshot>('overlay-snapshot', (event) => {
        if (!disposed) setSnapshot((current) => newerOverlay(current, event.payload));
      });
      if (disposed) {
        unlisten();
        return;
      }
      unsubscribe = unlisten;
      const initial = await readOverlay();
      if (!disposed) setSnapshot((current) => newerOverlay(current, initial));
    }
    void initialize().catch(() => {
      if (!disposed) setError('字幕同步失败，请返回主窗口。');
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  async function action(operation: () => Promise<unknown>) {
    try {
      await operation();
      setError('');
    } catch {
      setError('操作失败，请返回主窗口。');
    }
  }
  const active = snapshot.phase !== 'idle';
  return (
    <div
      className="subtitle-overlay"
      style={{
        backgroundColor: `rgba(22, 24, 29, ${snapshot.backgroundOpacity})`,
        fontSize: snapshot.fontSize,
      }}
    >
      <header className="subtitle-overlay-toolbar" data-tauri-drag-region title="拖动字幕窗口">
        <span data-tauri-drag-region>{active ? '双语字幕' : '监听已停止'}</span>
        <div>
          {active && <button onClick={() => void action(stopOverlayListening)}>停止监听</button>}
          <button onClick={() => void action(focusMain)} title="收起字幕窗并返回主窗口，继续监听">
            返回主窗口
          </button>
        </div>
      </header>
      {error && (
        <div className="subtitle-overlay-error" role="alert">
          {error}
        </div>
      )}
      <main className="subtitle-overlay-content" aria-live="polite">
        {snapshot.lines.length ? (
          snapshot.lines.map((line, index) => (
            <article key={`${snapshot.sessionId}-${index}`}>
              <p className="subtitle-overlay-source">{line.source}</p>
              {line.translation && (
                <p className="subtitle-overlay-translation">{line.translation}</p>
              )}
            </article>
          ))
        ) : (
          <p className="subtitle-overlay-empty">{active ? '等待字幕…' : '暂无字幕'}</p>
        )}
      </main>
    </div>
  );
}
