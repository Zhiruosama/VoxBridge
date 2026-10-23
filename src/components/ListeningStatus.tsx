import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, ChevronDown, Info, LoaderCircle, X } from 'lucide-react';
import { captureHealthMessage, type CaptureHealth } from '../core/capture-health';
import type { ListeningEvent } from '../core/types';

export type ListeningPhase = 'idle' | 'starting' | 'running' | 'stopping';
export type ListeningProgress = Extract<ListeningEvent, { type: 'progress' }>;

function StatusPopover({
  label,
  summary,
  children,
  className = '',
}: {
  label: string;
  summary: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (ref.current?.open && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector('summary')?.focus();
      }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  return (
    <details className={`status-popover ${className}`} ref={ref} name="listening-popovers">
      <summary aria-label={label} title={label}>
        {summary}
      </summary>
      <div className="status-popover-panel">{children}</div>
    </details>
  );
}

export default function ListeningStatus({
  phase,
  health,
  progress,
}: {
  phase: ListeningPhase;
  health: CaptureHealth;
  progress: ListeningProgress | null;
}) {
  const pending = phase === 'starting' || phase === 'stopping';
  const label =
    phase === 'starting'
      ? '正在连接'
      : phase === 'stopping'
        ? '正在停止'
        : health === 'active'
          ? '监听中'
          : health === 'stalled'
            ? '等待连接'
            : '等待声音';
  return (
    <div className="listening-controls">
      {phase !== 'idle' && (
        <StatusPopover
          label="查看监听详情"
          className="signal-popover"
          summary={
            <>
              {pending ? (
                <LoaderCircle size={12} className="status-spinner" aria-hidden="true" />
              ) : (
                <span className={`signal-dot${health === 'active' ? ' is-active' : ''}`} />
              )}
              <span role="status">{label}</span>
              <ChevronDown size={11} aria-hidden="true" />
            </>
          }
        >
          <h3>监听详情</h3>
          {progress ? (
            <dl className="signal-metrics">
              <div>
                <dt>采样率</dt>
                <dd>{progress.sampleRate.toLocaleString()} Hz</dd>
              </div>
              <div>
                <dt>音频电平</dt>
                <dd>{progress.rms.toFixed(4)}</dd>
              </div>
              <div>
                <dt>已接收帧</dt>
                <dd>{progress.frames.toLocaleString()}</dd>
              </div>
              <div>
                <dt>丢弃帧</dt>
                <dd>{progress.droppedFrames.toLocaleString()}</dd>
              </div>
              <div>
                <dt>跳过片段</dt>
                <dd>{progress.droppedSegments.toLocaleString()}</dd>
              </div>
              <div>
                <dt>音频断点</dt>
                <dd>{progress.discontinuities.toLocaleString()}</dd>
              </div>
            </dl>
          ) : (
            <p>正在连接音频进程，请留意系统权限提示。</p>
          )}
          {phase === 'running' && health !== 'active' && (
            <p className="signal-explanation">{captureHealthMessage(health)}</p>
          )}
        </StatusPopover>
      )}
      <StatusPopover
        label="监听说明"
        className="listening-help"
        summary={<Info size={15} aria-hidden="true" />}
      >
        <h3>关于监听</h3>
        <p>先让目标应用发声，再刷新并选择音频进程。</p>
        <p>监听会调用所选的语音识别与翻译服务，可能产生费用。</p>
        <p>监听期间暂停语音输出；停止监听后可使用下方文字表达。</p>
      </StatusPopover>
    </div>
  );
}

export function ListeningNotice({
  message,
  overlay = false,
  onDismiss,
  onSettings,
  onRefresh,
  refreshing,
}: {
  message: string;
  overlay?: boolean;
  onDismiss: () => void;
  onSettings: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (!message) return null;
  const credential = message.includes('密钥');
  const source = message.includes('进程') && (message.includes('退出') || message.includes('改变'));
  const title = overlay
    ? '悬浮字幕暂不可用'
    : credential
      ? '需要配置服务密钥'
      : source
        ? '音频进程已退出'
        : '监听遇到问题';
  const description = credential
    ? '请在服务设置中添加密钥后重试。'
    : source
      ? '刷新列表，重新选择要监听的应用。'
      : message;
  return (
    <div className="listening-notice" role="alert">
      <AlertCircle size={16} className="notice-symbol" aria-hidden="true" />
      <div className="listening-notice-copy">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {credential && (
        <button className="notice-action" onClick={onSettings}>
          服务设置
        </button>
      )}
      {source && (
        <button className="notice-action" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? '刷新中…' : '刷新进程'}
        </button>
      )}
      <button className="icon-button notice-dismiss" aria-label="关闭监听提示" onClick={onDismiss}>
        <X size={14} />
      </button>
    </div>
  );
}
