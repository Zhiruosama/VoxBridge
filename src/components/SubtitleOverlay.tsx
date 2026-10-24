import OverlayVoiceControls from './OverlayVoiceControls';
import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { focusMain, readOverlay, stopOverlayListening } from '../bridge';
import { newerOverlay, subtitleDefaults } from '../core/overlay';
import { useReadingFollow } from '../hooks/useReadingFollow';
import { useOverlayDrag } from '../hooks/useOverlayDrag';
import { useTextSelection } from '../hooks/useTextSelection';
import type { OverlaySnapshot } from '../core/types';

export default function SubtitleOverlay() {
  useTextSelection();
  const [snapshot, setSnapshot] = useState<OverlaySnapshot>({
    version: 0,
    sessionId: null,
    phase: 'idle',
    lines: [],
    ...subtitleDefaults,
  });
  const [error, setError] = useState('');
  const reading = useReadingFollow(snapshot, snapshot.sessionId, snapshot.mode);
  const [hiddenThrough, setHiddenThrough] = useState<Set<string>>(new Set());
  const lines = snapshot.lines.filter((line) => !hiddenThrough.has(line.segmentId));
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
  const drag = useOverlayDrag(() => setError('无法拖动字幕窗，请重试。'));
  const active = snapshot.phase !== 'idle';
  return (
    <div
      className="subtitle-overlay"
      style={{
        backgroundColor: `rgba(22, 24, 29, ${snapshot.backgroundOpacity})`,
        fontSize: snapshot.fontSize,
        color: snapshot.textColor,
        lineHeight: snapshot.lineHeight,
      }}
    >
      <header className="subtitle-overlay-toolbar" title="拖动字幕窗口" {...drag}>
        <span>
          {snapshot.phase === 'recovering' ? '正在恢复监听…' : active ? '字幕' : '监听已停止'}
        </span>
        <div>
          <button
            onClick={() => {
              setHiddenThrough(new Set(snapshot.lines.map((line) => line.segmentId)));
              reading.jumpLatest();
            }}
            title="清空此浮窗中的当前字幕，继续监听"
          >
            清空
          </button>
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
      <main
        ref={reading.ref}
        onScroll={reading.onScroll}
        className={`subtitle-overlay-content is-${snapshot.mode}`}
        data-selection-scope
        aria-label="字幕内容"
      >
        {lines.length ? (
          lines.map((line) => (
            <article key={line.segmentId} data-caption-id={line.segmentId}>
              {(snapshot.content !== 'translation' || !line.translation) && (
                <p
                  className={
                    snapshot.content === 'bilingual' || snapshot.content === 'translation'
                      ? 'subtitle-overlay-source'
                      : 'subtitle-overlay-translation'
                  }
                >
                  {line.source}
                </p>
              )}
              {snapshot.content !== 'source' && line.translation && (
                <p className="subtitle-overlay-translation">{line.translation}</p>
              )}
              {snapshot.content !== 'source' && !line.translation && line.final && (
                <span className="subtitle-overlay-pending">
                  {line.translationState === 'failed' ? '暂未译出' : '翻译中…'}
                </span>
              )}
            </article>
          ))
        ) : (
          <p className="subtitle-overlay-empty">{active ? '等待字幕…' : '暂无字幕'}</p>
        )}
      </main>
      <OverlayVoiceControls
        leading={
          !reading.follow && lines.length > 0 ? (
            <button className="subtitle-overlay-latest" onClick={reading.jumpLatest}>
              ↓ 回到最新
            </button>
          ) : undefined
        }
      />
    </div>
  );
}
