import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle } from 'lucide-react';
import type { QueueAction, QueueView } from '../core/send-queue';
export default function SendQueueControls({
  view,
  onAction,
}: {
  view: QueueView;
  onAction: (action: QueueAction) => void;
}) {
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState(''),
    [text, setText] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!view.items.length) setOpen(false);
  }, [view.items.length]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !panel.current?.contains(event.target)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  if (!view.items.length) return null;
  const hasFailure = view.items.some((item) => item.status === 'failed');
  const labels: Record<string, string> = {
    queued: '待处理',
    preparing: '准备中',
    detecting: '识别语言',
    translating: '翻译中',
    synthesizing: '合成中',
    ready: '等待播放',
    playing: '播放中',
    waitingDevice: '等待设备',
    decoding: '准备播放',
    failed: '失败',
    stopping: '停止中',
  };
  return (
    <>
      <button
        ref={trigger}
        className={`queue-trigger${hasFailure ? ' has-failure' : ''}`}
        aria-label={t(hasFailure ? '查看发送队列，有失败项' : '查看发送队列')}
        aria-expanded={open}
        onClick={() => {
          const r = trigger.current!.getBoundingClientRect();
          setPosition({
            left: Math.max(12, Math.min(r.right - 340, window.innerWidth - 352)),
            top: Math.max(12, r.top - Math.min(330, window.innerHeight - 80) - 8),
          });
          setOpen(!open);
        }}
      >
        {hasFailure && <AlertCircle size={13} aria-hidden="true" />}
        {t('队列')}
      </button>
      {open &&
        createPortal(
          <section
            ref={panel}
            className="send-queue-panel"
            style={position}
            aria-label={t('发送队列')}
          >
            <header>
              <strong>
                {t('发送队列')} · {view.items.length}
              </strong>
              <button
                onClick={() => onAction({ action: view.paused ? 'queueResume' : 'queuePause' })}
              >
                {t(view.paused ? '继续' : '暂停')}
              </button>
              <button aria-label={t('关闭发送队列')} onClick={() => setOpen(false)}>
                ×
              </button>
            </header>
            {hasFailure && (
              <p className="queue-error" role="status">
                {t('失败项不会阻塞后续发送，可单独重试或取消。')}
              </p>
            )}
            <div className="send-queue-items">
              {view.items.map((item) => (
                <article key={item.id}>
                  <div className="queue-item-heading">
                    <span>
                      {t(labels[item.status] || '准备中')}
                      {item.targetLanguage ? ` · ${t(item.targetLanguage)}` : ''}
                    </span>
                    <button onClick={() => onAction({ action: 'queueCancel', id: item.id })}>
                      {t('取消')}
                    </button>
                  </div>
                  {editing === item.id ? (
                    <>
                      <textarea
                        aria-label={t('编辑待发送内容')}
                        maxLength={2000}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                      />
                      <button
                        disabled={!text.trim()}
                        onClick={() => {
                          onAction({ action: 'queueEdit', id: item.id, text });
                          setEditing('');
                        }}
                      >
                        {t('保存')}
                      </button>
                      <button onClick={() => setEditing('')}>{t('返回')}</button>
                    </>
                  ) : (
                    <>
                      <p>{item.text}</p>
                      {item.error && <p className="queue-error">{t(item.error)}</p>}
                      <div className="queue-item-actions">
                        {!item.active && (
                          <button
                            aria-description={t('已合成的内容修改后需要重新合成，可能计费')}
                            onClick={() => {
                              setEditing(item.id);
                              setText(item.text);
                            }}
                          >
                            {t('编辑')}
                          </button>
                        )}
                        {item.status === 'failed' && (
                          <button
                            aria-description={t('重新请求翻译和语音服务，可能计费')}
                            onClick={() => onAction({ action: 'queueRetry', id: item.id })}
                          >
                            {t('重试')}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>
          </section>,
          document.body,
        )}
    </>
  );
}
