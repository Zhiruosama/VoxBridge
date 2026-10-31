import type { TextTools } from '../hooks/useTextTools';
import { recoveryHint } from '../core/operation-feedback';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { textSplitRatio, textSplitStorageKey } from '../core/text-translation-layout';
import { ArrowRight, Check, Copy, LoaderCircle, Settings2, X } from 'lucide-react';
import { textTranslationSubmitKey, type TextTranslationController } from '../core/text-translation';
import { profileFor } from '../core/settings';
import { usesBuiltinProfileName } from '../core/provider-presets';
import type { Settings } from '../core/types';
import { t } from '../i18n';
import Select from './Select';

const languages = [
  '英语',
  '简体中文',
  '日语',
  '韩语',
  '西班牙语',
  '印尼语',
  '粤语',
  '芬兰语',
  '俄语',
  '德语',
];
export default function TextTranslation({
  controller,
  tools,
  settings,
  onSettings,
}: {
  controller: TextTranslationController;
  tools: TextTools;
  settings: Settings;
  onSettings: () => void;
}) {
  const [ratio, setRatio] = useState(() => {
    try {
      return textSplitRatio(JSON.parse(localStorage.getItem(textSplitStorageKey) ?? 'null'));
    } catch {
      return 50;
    }
  });
  const panels = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    width: number;
    ratio: number;
    latest: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  function changeRatio(value: number, persist = true) {
    const next = textSplitRatio(value);
    setRatio(next);
    if (persist) {
      try {
        localStorage.setItem(textSplitStorageKey, JSON.stringify(next));
      } catch {
        /* Keep resizing usable without storage. */
      }
    }
  }
  function finishResize() {
    if (!drag.current) return;
    changeRatio(drag.current.latest);
    drag.current = null;
    setDragging(false);
  }
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!state.busy) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.floor((Date.now() - state.startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [state.busy, state.startedAt]);
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState(false);
  const profile = profileFor(settings, 'translation');
  const options = languages.map((label) => ({ label, value: label }));
  const submit = tools.translate;
  return (
    <section
      className="text-translation"
      aria-label={t('文本翻译')}
      style={{ '--text-panel-opacity': `${settings.textTranslationOpacity}%` } as CSSProperties}
    >
      <div className="text-translation-toolbar">
        <div className="text-translation-direction">
          <Select
            label="原文语言"
            value={state.source}
            options={[{ value: '自动识别', label: '自动识别' }, ...options]}
            onChange={(source) => controller.update({ source })}
          />
          <ArrowRight size={16} aria-hidden="true" />
          <Select
            label="目标语言"
            value={state.target}
            options={options}
            onChange={(target) => controller.update({ target })}
          />
        </div>
        <button className="subtle" onClick={onSettings}>
          <Settings2 size={14} aria-hidden="true" />
          {t('翻译设置')}
        </button>
      </div>
      <div className="clipboard-tools">
        <div className="clipboard-tools-controls">
          <button
            role="switch"
            aria-checked={tools.watching}
            disabled={!tools.available}
            onClick={() => tools.changeWatching(!tools.watching)}
          >
            {t('监听剪贴板')}
            <span className="clipboard-switch-dot" aria-hidden="true" />
          </button>
          <button
            role="switch"
            aria-checked={tools.automatic}
            disabled={!tools.watching}
            onClick={() => tools.setAutomatic(!tools.automatic)}
          >
            {t('自动翻译')}
            <span className="clipboard-switch-dot" aria-hidden="true" />
          </button>
          <button
            className="subtle"
            disabled={!tools.available}
            onClick={() => void tools.openOverlay()}
          >
            {t('翻译浮窗')}
          </button>
        </div>
        {tools.watching && (
          <p>
            {t(
              tools.automatic
                ? '新复制的文字会发送至当前翻译服务。'
                : '新复制的文字会填入原文框，确认后再翻译。',
            )}
          </p>
        )}
        {tools.message && <p role="status">{t(tools.message)}</p>}
      </div>
      <div
        ref={panels}
        className={`text-translation-panels${dragging ? ' is-resizing' : ''}`}
        style={{ '--text-left': `${ratio}fr`, '--text-right': `${100 - ratio}fr` } as CSSProperties}
      >
        <div className="text-translation-panel">
          <label htmlFor="text-translation-input">{t('原文')}</label>
          <textarea
            id="text-translation-input"
            value={state.input}
            placeholder={t('输入要翻译的文字…')}
            aria-description={t('Enter 翻译，Shift + Enter 换行。')}
            onChange={(event) => controller.update({ input: event.target.value })}
            onKeyDown={(event) => {
              if (
                textTranslationSubmitKey({
                  key: event.key,
                  shiftKey: event.shiftKey,
                  altKey: event.altKey,
                  isComposing: event.nativeEvent.isComposing,
                  keyCode: event.nativeEvent.keyCode,
                })
              ) {
                event.preventDefault();
                if (!event.repeat && state.input.trim()) submit();
              }
            }}
          />
          <div className="text-translation-footer">
            <span className={[...state.input].length > 2000 ? 'error' : ''}>
              {[...state.input].length} / 2000
            </span>
            <div>
              <button
                className="subtle"
                onClick={controller.clear}
                disabled={!state.input && !state.result && !state.busy}
              >
                {t('清空')}
              </button>
              {state.busy ? (
                <button onClick={controller.cancel}>
                  <X size={14} />
                  {t('取消')}
                </button>
              ) : (
                <button onClick={submit} disabled={!state.input.trim()}>
                  {t('翻译')}
                  <ArrowRight size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div
          className="text-translation-divider"
          role="separator"
          tabIndex={0}
          aria-label={t('调整翻译区域宽度')}
          aria-orientation="vertical"
          aria-description={t('左右拖动调整，双击恢复等宽。')}
          aria-valuemin={30}
          aria-valuemax={70}
          aria-valuenow={ratio}
          onDoubleClick={() => changeRatio(50)}
          onKeyDown={(event) => {
            const next =
              event.key === 'ArrowLeft'
                ? ratio - 2
                : event.key === 'ArrowRight'
                  ? ratio + 2
                  : event.key === 'Home'
                    ? 30
                    : event.key === 'End'
                      ? 70
                      : null;
            if (next !== null) {
              event.preventDefault();
              changeRatio(next);
            }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary || !panels.current) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              id: event.pointerId,
              x: event.clientX,
              width: panels.current.clientWidth - 18,
              ratio,
              latest: ratio,
            };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (!current || current.id !== event.pointerId) return;
            current.latest = textSplitRatio(
              current.ratio + (100 * (event.clientX - current.x)) / Math.max(1, current.width),
            );
            changeRatio(current.latest, false);
          }}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onLostPointerCapture={finishResize}
        />
        <div className="text-translation-panel" aria-busy={state.busy}>
          <div className="text-translation-result-heading">
            <span>
              {t('译文')}
              {state.resultTarget && (
                <span className="text-translation-language"> · {t(state.resultTarget)}</span>
              )}
            </span>
            <button
              className="icon-button"
              aria-label={t('复制译文')}
              disabled={!state.result}
              onClick={() => {
                setCopyError(false);
                void tools
                  .copy(state.result)
                  .then(() => setCopied(state.result))
                  .catch(() => setCopyError(true));
              }}
            >
              {copied && copied === state.result ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <div
            className={`text-translation-result ${state.result ? '' : 'text-translation-placeholder'}`}
            data-selection-scope
          >
            {state.result || t('译文将显示在这里')}
          </div>
          {state.error && (
            <div className="text-translation-error" role="alert">
              <p>{t(recoveryHint(state.error))}</p>
              <div className="recovery-actions">
                {state.canRetry && (
                  <button disabled={state.busy} onClick={() => void controller.retry(profile)}>
                    {t('重试上一条')}
                  </button>
                )}
                <button onClick={onSettings}>{t('翻译设置')}</button>
              </div>
              <details>
                <summary>{t('错误详情')}</summary>
                <p>{t(state.error)}</p>
              </details>
            </div>
          )}
          <div className="text-translation-footer" role="status">
            {state.busy ? (
              <span className="text-translation-progress">
                <LoaderCircle size={14} className="status-spinner" />
                {t(elapsed >= 10 ? '服务响应较慢，可取消后重试。' : '翻译中…')} · {elapsed}s
              </span>
            ) : (
              <span>{usesBuiltinProfileName(profile) ? t(profile.name) : profile.name}</span>
            )}
            {copyError && <span>{t('复制失败，请手动选择译文复制。')}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
