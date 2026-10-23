import { useEffect, useRef, useState } from 'react';
import { Play, RefreshCw, Square } from 'lucide-react';
import { captureDiagnostic, listCaptureSources, stopCapture } from '../bridge';
import type { CaptureProgress, CaptureSource } from '../core/types';
import Select from './Select';
import SettingRow from './SettingRow';

export default function CaptureDiagnostic({ enabled }: { enabled: boolean }) {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'running' | 'stopping'>('idle');
  const [progress, setProgress] = useState<CaptureProgress | null>(null);
  const [error, setError] = useState('');
  const sessionRef = useRef<string | null>(null);
  const stoppingRef = useRef(false);
  const mountedRef = useRef(true);
  const busy = phase !== 'idle';
  const selected = sources.find((source) => String(source.pid) === sourceId);

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
    setError('');
    try {
      await captureDiagnostic(selected, id, (event) => {
        if (!mountedRef.current || sessionRef.current !== event.sessionId) return;
        setProgress(event);
        if (event.phase === 'running' && !stoppingRef.current) setPhase('running');
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
        <h2 id="capture-test-heading">应用声音采集诊断</h2>
        <button
          className="subtle"
          onClick={() => void refresh()}
          disabled={!enabled || busy || refreshing}
        >
          <RefreshCw size={14} />
          {refreshing ? '刷新中…' : '刷新进程'}
        </button>
      </div>
      <div className="preference-card">
        <SettingRow title="目标音频进程">
          <Select
            label="目标音频进程"
            value={sourceId}
            onChange={setSourceId}
            disabled={!enabled || busy || refreshing}
            placeholder="先让目标应用发声，再刷新进程"
            options={sources.map((source) => ({
              value: String(source.pid),
              label: `${source.bundleId || '未命名音频进程'} · PID ${source.pid}`,
            }))}
          />
        </SettingRow>
        <SettingRow title="本地诊断">
          {busy ? (
            <button onClick={() => void stop()} disabled={phase === 'stopping'}>
              <Square size={14} />
              {phase === 'stopping' ? '正在停止…' : '停止采集'}
            </button>
          ) : (
            <button onClick={() => void start()} disabled={!enabled || !selected || refreshing}>
              <Play size={14} />
              开始采集诊断
            </button>
          )}
        </SettingRow>
        <SettingRow title="采集电平">
          <span className="preference-value" role="status">
            {phase === 'starting'
              ? '正在初始化，请留意系统权限提示'
              : phase === 'stopping'
                ? '正在释放采集资源'
                : progress && progress.sampleRate > 0
                  ? `${progress.sampleRate} Hz · RMS ${progress.rms.toFixed(5)} · ${progress.frames} 帧 · 丢弃 ${progress.droppedFrames} 帧`
                  : '未开始采集'}
          </span>
        </SettingRow>
      </div>
      <p
        className={`diagnostic-feedback${error ? ' error-text' : ''}`}
        role={error ? 'alert' : 'status'}
      >
        {error ||
          (enabled
            ? '只采集选定 PID；其他子进程需单独选择。最长 60 秒，离开此页会停止。不保存、不上传声音；未接入 ASR，零电平不代表权限已通过。'
            : '应用声音采集诊断仅支持 Mac 桌面版。')}
      </p>
    </section>
  );
}
