import { useEffect, useState } from 'react';
import { Copy, ArrowUpRight, X, LoaderCircle } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { hideTextOverlay, readTextOverlay, textOverlayAction } from '../bridge';
import {
  textOverlayDefaults,
  type TextOverlaySnapshot,
  type TextOverlayAction,
} from '../core/text-overlay';
import { t, setUiLanguage, useUiLanguage } from '../i18n';
import { useOverlayDrag } from '../hooks/useOverlayDrag';
import { useTextSelection } from '../hooks/useTextSelection';
import OverlayResizeHandles from './OverlayResizeHandles';

export default function TextTranslationOverlay() {
  useUiLanguage();
  useTextSelection();
  const [snapshot, setSnapshot] = useState(textOverlayDefaults);
  const [error, setError] = useState('');
  useEffect(() => {
    setUiLanguage(snapshot.uiLanguage);
  }, [snapshot.uiLanguage]);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const update = (next: TextOverlaySnapshot) => {
      if (!disposed) setSnapshot((old) => (next.version > old.version ? next : old));
    };
    void (async () => {
      const unlisten = await listen<TextOverlaySnapshot>('text-overlay-snapshot', (event) =>
        update(event.payload),
      );
      if (disposed) {
        unlisten();
        return;
      }
      cleanup = unlisten;
      update(await readTextOverlay());
    })().catch(() => {
      if (!disposed) setError('文本浮窗同步失败，请重试。');
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
  useEffect(() => {
    function copySelection(event: ClipboardEvent) {
      const selection = window.getSelection();
      if (selection?.anchorNode?.parentElement?.closest('.text-overlay-result')) {
        const text = selection.toString();
        if (text) {
          event.preventDefault();
          void textOverlayAction({ action: 'copy', text }).catch(() =>
            setError('复制失败，请手动选择译文复制。'),
          );
        }
      }
    }
    document.addEventListener('copy', copySelection);
    return () => document.removeEventListener('copy', copySelection);
  }, []);
  const drag = useOverlayDrag(() => setError('无法拖动字幕窗，请重试。'));
  async function act(request: TextOverlayAction) {
    try {
      await textOverlayAction(request);
      setError('');
    } catch {
      setError('操作失败，请返回主窗口。');
    }
  }
  return (
    <div
      className="subtitle-overlay text-result-overlay"
      style={
        {
          '--overlay-background': `rgba(22,24,29,${snapshot.appearance.backgroundOpacity})`,
          '--text-overlay-font-size': `${snapshot.appearance.fontSize}px`,
          '--text-overlay-line-height': snapshot.appearance.lineHeight,
          '--text-overlay-color': snapshot.appearance.textColor,
        } as React.CSSProperties
      }
    >
      <section className="subtitle-overlay-panel">
        <header className="subtitle-overlay-toolbar" {...drag}>
          <span>
            {t('文本翻译')}
            {snapshot.target ? ` · ${t(snapshot.target)}` : ''}
          </span>
          <div>
            {snapshot.watching && (
              <button onClick={() => void act({ action: 'pause' })}>{t('暂停监听')}</button>
            )}
            <button
              className="icon-button"
              aria-label={t('返回文本翻译')}
              onClick={() => void act({ action: 'focus' })}
            >
              <ArrowUpRight size={15} />
            </button>
            <button
              className="icon-button"
              aria-label={t('隐藏文本浮窗')}
              onClick={() =>
                void hideTextOverlay().catch(() => setError('操作失败，请返回主窗口。'))
              }
            >
              <X size={15} />
            </button>
          </div>
        </header>
        <main
          dir="auto"
          className="text-overlay-result"
          data-selection-scope
          aria-live="polite"
          aria-busy={snapshot.busy}
        >
          {snapshot.result || (
            <span className="text-overlay-placeholder">
              {t(
                snapshot.busy
                  ? '翻译中…'
                  : snapshot.canTranslate
                    ? '文字已就绪，点击翻译'
                    : snapshot.watching
                      ? '复制文字后，译文将在这里显示'
                      : '译文将显示在这里',
              )}
            </span>
          )}
        </main>
        {(error || snapshot.error || snapshot.copyError) && (
          <p className="subtitle-overlay-error" role="alert">
            {t(error || snapshot.error || '复制失败，请手动选择译文复制。')}
          </p>
        )}
        <footer className="text-overlay-actions">
          {snapshot.busy && (
            <LoaderCircle size={14} className="status-spinner" aria-label={t('翻译中…')} />
          )}
          <button
            disabled={!snapshot.canTranslate}
            onClick={() => void act({ action: 'translate' })}
          >
            {t('翻译')}
          </button>
          <button
            disabled={!snapshot.result}
            onClick={() => {
              void act({ action: 'copy', text: snapshot.result });
            }}
          >
            <Copy size={14} />
            {t(snapshot.copied ? '已复制' : '复制译文')}
          </button>
        </footer>
      </section>
      <OverlayResizeHandles onError={() => setError('无法调整字幕窗大小，请重试。')} />
    </div>
  );
}
