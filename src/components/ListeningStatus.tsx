import { t } from '../i18n';
import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, ChevronDown, Info, LoaderCircle, X } from 'lucide-react';
import { captureHealthMessage, type CaptureHealth } from '../core/capture-health';
import type { ListeningEvent, TranslationMetrics, RecognitionMetrics } from '../core/types';

export type ListeningPhase = 'idle' | 'starting' | 'running' | 'recovering' | 'stopping';
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
      <summary aria-label={t(label)} aria-description={t(label)}>
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
  recovery,
  translationMetrics,
  recognitionMetrics,
}: {
  phase: ListeningPhase;
  health: CaptureHealth;
  progress: ListeningProgress | null;
  recovery?: Extract<ListeningEvent, { type: 'recovering' }> | null;
  translationMetrics?: TranslationMetrics | null;
  recognitionMetrics?: RecognitionMetrics | null;
}) {
  const pending = phase === 'starting' || phase === 'recovering' || phase === 'stopping';
  const label =
    phase === 'recovering'
      ? '正在恢复'
      : phase === 'starting'
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
          label={t('查看监听详情')}
          className="signal-popover"
          summary={
            <>
              {pending ? (
                <LoaderCircle size={12} className="status-spinner" aria-hidden="true" />
              ) : (
                <span className={`signal-dot${health === 'active' ? ' is-active' : ''}`} />
              )}
              <span role="status">{t(label)}</span>
              <ChevronDown size={11} aria-hidden="true" />
            </>
          }
        >
          <h3>{t('监听详情')}</h3>
          {phase === 'recovering' && recovery ? (
            <p>
              {t(
                '{0} 将在 {1} 秒后重试（第 {2} 次）。',
                t(recovery.reason),
                Math.ceil(recovery.delayMs / 1000),
                recovery.attempt,
              )}
            </p>
          ) : progress ? (
            <dl className="signal-metrics">
              <div>
                <dt>{t('采样率')}</dt>
                <dd>{progress.sampleRate.toLocaleString()} Hz</dd>
              </div>
              <div>
                <dt>{t('音频电平')}</dt>
                <dd>{progress.rms.toFixed(4)}</dd>
              </div>
              <div>
                <dt>{t('已接收帧')}</dt>
                <dd>{progress.frames.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{t('丢弃帧')}</dt>
                <dd>{progress.droppedFrames.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{t('跳过片段')}</dt>
                <dd>{progress.droppedSegments.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{t('音频断点')}</dt>
                <dd>{progress.discontinuities.toLocaleString()}</dd>
              </div>
            </dl>
          ) : (
            <p>{t('正在连接应用声音，请留意系统权限提示。')}</p>
          )}
          {recognitionMetrics && (
            <details>
              <summary>{t('识别与断句')}</summary>
              <dl className="signal-metrics">
                <div>
                  <dt>{t('首个临时结果')}</dt>
                  <dd>
                    {t(
                      recognitionMetrics.firstPartialMs === null
                        ? '未收到'
                        : `${recognitionMetrics.firstPartialMs} ms`,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t('首个供应商句末')}</dt>
                  <dd>
                    {t(
                      recognitionMetrics.firstFinalMs === null
                        ? '未收到'
                        : `${recognitionMetrics.firstFinalMs} ms`,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t('供应商句末 / 本地提交')}</dt>
                  <dd>
                    {recognitionMetrics.providerFinals} / {recognitionMetrics.committedCaptions}
                  </dd>
                </div>
                <div>
                  <dt>{t('临时至句末 P50 / P95')}</dt>
                  <dd>
                    {t(
                      recognitionMetrics.finalizationSamples
                        ? `${recognitionMetrics.partialToFinalP50Ms} / ${recognitionMetrics.partialToFinalP95Ms} ms`
                        : '暂无样本',
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t('更新至提交 P50 / P95')}</dt>
                  <dd>
                    {t(
                      recognitionMetrics.commitSamples
                        ? `${recognitionMetrics.commitHoldP50Ms} / ${recognitionMetrics.commitHoldP95Ms} ms`
                        : '暂无样本',
                    )}
                  </dd>
                </div>
              </dl>
              <p>
                {t(
                  '首个结果从本次连接启动计时，包含连接与等待声音。临时至句末包含说话时长；更新至提交从最近识别更新计时。均非纯 ASR 网络延迟，最多保留 128 段样本。',
                )}
              </p>
            </details>
          )}
          {translationMetrics && (
            <>
              <h3>{t('实时翻译')}</h3>
              <dl className="signal-metrics">
                <div>
                  <dt>{t('排队 / 请求中')}</dt>
                  <dd>
                    {translationMetrics.queued} / {translationMetrics.inflight}
                  </dd>
                </div>
                <div>
                  <dt>{t('已处理 / 失败')}</dt>
                  <dd>
                    {translationMetrics.completed} / {translationMetrics.failed}
                  </dd>
                </div>
                <div>
                  <dt>{t('排队 P50 / P95')}</dt>
                  <dd>
                    {translationMetrics.queueP50Ms} / {translationMetrics.queueP95Ms} ms
                  </dd>
                </div>
                <div>
                  <dt>{t('请求 P50 / P95')}</dt>
                  <dd>
                    {translationMetrics.requestP50Ms} / {translationMetrics.requestP95Ms} ms
                  </dd>
                </div>
                <div>
                  <dt>{t('提交至译出 P50 / P95')}</dt>
                  <dd>
                    {translationMetrics.totalP50Ms} / {translationMetrics.totalP95Ms} ms
                  </dd>
                </div>
              </dl>
              <p>
                {t(
                  '最近 {0} 段，最多 128 段；请求含重试等待，不含采集与识别时间。失败请求也计入耗时。',
                  translationMetrics.sampleCount,
                )}
              </p>
            </>
          )}
          {phase === 'running' && health !== 'active' && (
            <p className="signal-explanation">{t(captureHealthMessage(health))}</p>
          )}
        </StatusPopover>
      )}
      <StatusPopover
        label={t('监听说明')}
        className="listening-help"
        summary={<Info size={15} aria-hidden="true" />}
      >
        <h3>{t('关于监听')}</h3>
        <p>{t('选择要监听的应用，例如 Chrome 或微信；播放声音后开始识别。')}</p>
        <p>{t('监听会调用所选的语音识别与翻译服务，可能产生费用。')}</p>
        <p>
          {t(
            '监听期间可同时输入文字并发送语音。自动识别模式使用常规设置中的文字语言；指定听取语言时，文字按字幕的反方向翻译。请将聊天声音输出到耳机、发送语音输出到独立虚拟设备，避免回环。',
          )}
        </p>
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
        ? '监听应用暂不可用'
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
        <strong>{t(title)}</strong>
        <p>{t(description)}</p>
      </div>
      {credential && (
        <button className="notice-action" onClick={onSettings}>
          {t('服务设置')}
        </button>
      )}
      {source && (
        <button className="notice-action" onClick={onRefresh} disabled={refreshing}>
          {t(refreshing ? '刷新中…' : '刷新应用')}
        </button>
      )}
      <button
        className="icon-button notice-dismiss"
        aria-label={t('关闭监听提示')}
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}
