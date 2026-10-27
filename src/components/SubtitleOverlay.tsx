import CaptionFeed from './CaptionFeed';
import BilingualToggle from './BilingualToggle';
import { t, setUiLanguage, useUiLanguage } from '../i18n';
import OverlayVoiceControls from './OverlayVoiceControls';
import { useEffect, useState, type CSSProperties } from 'react';
import { listen } from '@tauri-apps/api/event';
import { focusMain, readOverlay, stopOverlayListening, overlayVoiceAction } from '../bridge';
import { newerOverlay, subtitleDefaults } from '../core/overlay';
import { useReadingFollow } from '../hooks/useReadingFollow';
import { useOverlayDrag } from '../hooks/useOverlayDrag';
import { useTextSelection } from '../hooks/useTextSelection';
import type { OverlaySnapshot } from '../core/types';

export default function SubtitleOverlay() {
  useUiLanguage();
  useTextSelection();
  const [snapshot, setSnapshot] = useState<OverlaySnapshot>({
    version: 0,
    sessionId: null,
    phase: 'idle',
    lines: [],
    ...subtitleDefaults,
  });
  useEffect(() => {
    if (snapshot.uiLanguage) setUiLanguage(snapshot.uiLanguage);
  }, [snapshot.uiLanguage]);
  const [error, setError] = useState('');
  const [changingContent, setChangingContent] = useState(false);
  const [editorContainer, setEditorContainer] = useState<HTMLDivElement | null>(null);
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
      style={
        {
          '--overlay-background': `rgba(22, 24, 29, ${snapshot.backgroundOpacity})`,
          fontSize: snapshot.fontSize,
          color: snapshot.textColor,
          lineHeight: snapshot.lineHeight,
        } as CSSProperties
      }
    >
      <section className="subtitle-overlay-panel" aria-label={t('悬浮字幕')}>
        <header className="subtitle-overlay-toolbar" aria-description={t('拖动字幕窗口')} {...drag}>
          <span>
            {t(snapshot.phase === 'recovering' ? '正在恢复监听…' : active ? '字幕' : '监听已停止')}
          </span>
          <div>
            <BilingualToggle
              checked={snapshot.content === 'bilingual'}
              disabled={changingContent}
              onChange={(bilingual) => {
                setChangingContent(true);
                void action(() =>
                  overlayVoiceAction({ action: 'subtitleContent', bilingual }),
                ).finally(() => setChangingContent(false));
              }}
            />
            <button
              onClick={() => {
                setHiddenThrough(new Set(snapshot.lines.map((line) => line.segmentId)));
                reading.jumpLatest();
              }}
              aria-description={t('清空此浮窗中的当前字幕，继续监听')}
            >
              {t('清空')}
            </button>
            {active && (
              <button onClick={() => void action(stopOverlayListening)}>{t('停止监听')}</button>
            )}
            <button
              onClick={() => void action(focusMain)}
              aria-description={t('收起字幕窗并返回主窗口，继续监听')}
            >
              {t('返回主窗口')}
            </button>
          </div>
        </header>
        {error && (
          <div className="subtitle-overlay-error" role="alert">
            {t(error)}
          </div>
        )}
        <main
          ref={reading.ref}
          onScroll={reading.onScroll}
          className={`subtitle-overlay-content is-${snapshot.mode}`}
          data-selection-scope
          aria-label={t('字幕内容')}
        >
          {lines.length ? (
            <CaptionFeed
              lines={lines}
              scope="overlay"
              content={snapshot.content}
              layout={
                snapshot.mode === 'continuous' ? (snapshot.captionLayout ?? 'sentence') : 'sentence'
              }
            />
          ) : (
            <p className="subtitle-overlay-empty">{t(active ? '等待字幕…' : '暂无字幕')}</p>
          )}
        </main>
        <OverlayVoiceControls
          editorContainer={editorContainer}
          leading={
            !reading.follow && lines.length > 0 ? (
              <button className="subtitle-overlay-latest" onClick={reading.jumpLatest}>
                {t('↓ 回到最新')}
              </button>
            ) : undefined
          }
        />
      </section>
      <div className="overlay-text-slot" ref={setEditorContainer} />
    </div>
  );
}
