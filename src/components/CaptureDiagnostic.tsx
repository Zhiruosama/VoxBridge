import { t } from '../i18n';
import { captureSourceKey, captureSourceLabel } from '../core/capture-sources';
import { useEffect, useRef, useState } from 'react';
import { Play, RefreshCw, Square } from 'lucide-react';
import { captureDiagnostic, listCaptureSources, stopCapture } from '../bridge';
import type { CaptureProgress, CaptureSource } from '../core/types';
import Select from './Select';
import SettingRow from './SettingRow';
import { CaptureSignalMonitor, captureHealthMessage } from '../core/capture-health';

export default function CaptureDiagnostic({ enabled }: { enabled: boolean }) {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'running' | 'stopping'>('idle');
  const [progress, setProgress] = useState<CaptureProgress | null>(null);
  const [error, setError] = useState('');
  const [signalMessage, setSignalMessage] = useState('');
  const signalRef = useRef(new CaptureSignalMonitor());
  const sessionRef = useRef<string | null>(null);
  const stoppingRef = useRef(false);
  const mountedRef = useRef(true);
  const busy = phase !== 'idle';
  const selected = sources.find((source) => captureSourceKey(source) === sourceId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) void stopCapture(id).catch(() => {});
    };
  }, []);

  async function refresh() {
    if (refreshing || sessionRef.current) return;
    setRefreshing(true);
    setError('');
    try {
      const next = await listCaptureSources();
      if (mountedRef.current) setSources(next);
    } catch (error) {
      if (mountedRef.current) setError(String(error));
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }

  async function start() {
    if (!selected || sessionRef.current) return;
    const id = crypto.randomUUID();
    sessionRef.current = id;
    stoppingRef.current = false;
    setPhase('starting');
    setProgress(null);
    setSignalMessage('');
    signalRef.current = new CaptureSignalMonitor();
    setError('');
    try {
      await captureDiagnostic(selected, id, (event) => {
        if (!mountedRef.current || sessionRef.current !== event.sessionId) return;
        setProgress(event);
        if (event.phase === 'running' && !stoppingRef.current) {
          setPhase('running');
          setSignalMessage(captureHealthMessage(signalRef.current.update(event)));
        }
      });
    } catch (error) {
      if (mountedRef.current && sessionRef.current === id) {
        const message = String(error);
        if (!(stoppingRef.current && message === '采集已停止。')) setError(message);
      }
    } finally {
      if (sessionRef.current === id) {
        sessionRef.current = null;
        if (mountedRef.current) setPhase('idle');
      }
    }
  }

  async function stop() {
    const id = sessionRef.current;
    if (!id || stoppingRef.current) return;
    stoppingRef.current = true;
    setPhase('stopping');
    try {
      await stopCapture(id);
    } catch (error) {
      if (mountedRef.current && sessionRef.current === id) {
        setError(String(error));
        stoppingRef.current = false;
        setPhase(progress?.phase === 'running' ? 'running' : 'starting');
      }
    }
  }

  return (
    <section className="preference-section" aria-labelledby="capture-test-heading">
      <div className="preference-section-title">
        <h2 id="capture-test-heading">{t('应用声音采集诊断')}</h2>
        <button
          className="subtle"
          onClick={() => void refresh()}
          disabled={!enabled || busy || refreshing}
        >
          <RefreshCw size={14} />
          {t(refreshing ? '刷新中…' : '刷新应用')}
        </button>
      </div>
      <div className="preference-card">
        <SettingRow title={t('目标应用')}>
          <Select
            label={t('目标应用')}
            value={sourceId}
            onChange={setSourceId}
            disabled={!enabled || busy || refreshing}
            placeholder={t('选择监听应用')}
            options={sources.map((source) => ({
              value: captureSourceKey(source),
              label: captureSourceLabel(source),
            }))}
          />
        </SettingRow>
        <SettingRow title={t('本地诊断')}>
          {busy ? (
            <button onClick={() => void stop()} disabled={phase === 'stopping'}>
              <Square size={14} />
              {t(phase === 'stopping' ? '正在停止…' : '停止采集')}
            </button>
          ) : (
            <button onClick={() => void start()} disabled={!enabled || !selected || refreshing}>
              <Play size={14} />
              {t('开始采集诊断')}
            </button>
          )}
        </SettingRow>
        <SettingRow title={t('采集电平')}>
          <span className="preference-value" role="status">
            {t(
              phase === 'starting'
                ? '正在初始化，请留意系统权限提示'
                : phase === 'stopping'
                  ? '正在释放采集资源'
                  : progress && progress.sampleRate > 0
                    ? t(
                        '{0} Hz · RMS {1} · {2} 帧 · 丢弃 {3} 帧',
                        progress.sampleRate,
                        progress.rms.toFixed(5),
                        progress.frames,
                        progress.droppedFrames,
                      )
                    : '未开始采集',
            )}
          </span>
        </SettingRow>
      </div>
      <p
        className={`diagnostic-feedback${error ? ' error-text' : ''}`}
        role={error ? 'alert' : 'status'}
      >
        {t(
          error ||
            (busy && phase === 'running' && signalMessage) ||
            (enabled
              ? '仅采集选定应用的声音，最长 60 秒，离开此页会停止。不保存、不上传声音；未接入 ASR，零电平不代表权限已通过。'
              : '当前系统尚未接入应用声音采集。'),
        )}
      </p>
    </section>
  );
}
