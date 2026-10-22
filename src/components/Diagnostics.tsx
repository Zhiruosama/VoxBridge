import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Pause, Play, RefreshCw, Square, Volume2 } from 'lucide-react';
import { desktop, listOutputs, stopTone, testTone } from '../bridge';
import type { OutputDevice, RuntimeInfo } from '../core/types';
import Select from './Select';
import SettingRow from './SettingRow';

export default function Diagnostics({
  runtime,
  notify,
  demo,
  onDemo,
}: {
  runtime: RuntimeInfo | null;
  notify: (message: string) => void;
  demo: boolean;
  onDemo: () => void;
}) {
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const playingRef = useRef(false);
  const stoppedRef = useRef(false);
  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const next = await listOutputs();
      setDevices(next);
      setDeviceId((current) => (next.some((device) => device.id === current) ? current : ''));
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      stoppedRef.current = true;
      void stopTone();
    };
  }, []);
  async function play() {
    if (playingRef.current) return;
    playingRef.current = true;
    stoppedRef.current = false;
    setBusy(true);
    setError('');
    try {
      await testTone(deviceId);
      if (!stoppedRef.current) notify('测试音播放结束，请确认所选设备的声音。');
    } catch (error) {
      setError(String(error));
    } finally {
      playingRef.current = false;
      setBusy(false);
      setStopping(false);
    }
  }
  async function stop() {
    stoppedRef.current = true;
    setStopping(true);
    try {
      await stopTone();
    } catch (error) {
      setError(String(error));
      setStopping(false);
    }
  }
  const platform = runtime
    ? ({ windows: 'Windows', macos: 'macOS', linux: 'Linux', browser: '网页预览' }[
        runtime.platform
      ] ?? runtime.platform)
    : '读取中…';
  return (
    <div className="preferences-page diagnostics-page">
      <header className="preferences-heading">
        <h1>音频与诊断</h1>
      </header>
      <section className="preference-section" aria-labelledby="output-test-heading">
        <div className="preference-section-title">
          <h2 id="output-test-heading">声音输出</h2>
          <button
            className="subtle"
            onClick={() => void refresh()}
            disabled={!desktop || loading || busy}
          >
            <RefreshCw size={14} />
            {loading ? '刷新中…' : '刷新设备'}
          </button>
        </div>
        <div className="preference-card">
          <SettingRow title="输出设备">
            <Select
              label="测试输出设备"
              value={deviceId}
              onChange={setDeviceId}
              disabled={!desktop || loading || busy}
              placeholder={loading ? '正在读取设备…' : '选择输出设备'}
              options={[
                ...new Map(
                  devices.map((device) => [device.id, { value: device.id, label: device.name }]),
                ).values(),
              ]}
            />
          </SettingRow>
          <SettingRow title="测试音">
            <div className="diagnostic-actions">
              {busy ? (
                <button onClick={() => void stop()} disabled={stopping}>
                  <Square size={14} />
                  {stopping ? '正在停止…' : '停止播放'}
                </button>
              ) : (
                <button
                  onClick={() => void play()}
                  disabled={!desktop || !deviceId || loading}
                  title="播放约 1 秒的低音量 440 Hz 测试音"
                >
                  <Volume2 size={15} />
                  播放测试音
                </button>
              )}
            </div>
          </SettingRow>
        </div>
        {error ? (
          <p role="alert" className="diagnostic-feedback error-text">
            {error}
          </p>
        ) : (
          <p className="diagnostic-feedback" role="status">
            {!desktop
              ? '请在桌面应用中测试音频。'
              : stopping
                ? '正在停止测试音…'
                : busy
                  ? '测试音正在播放到所选设备。'
                  : !loading && !devices.length
                    ? '未发现输出设备，请连接设备后刷新。'
                    : '测试音约 1 秒；选择虚拟音频设备时，声音可能进入通话。'}
          </p>
        )}
      </section>
      <section className="preference-section" aria-labelledby="subtitle-preview-heading">
        <h2 id="subtitle-preview-heading">字幕预览</h2>
        <div className="preference-card">
          <SettingRow title="示例对话">
            <button onClick={onDemo}>
              {demo ? <Pause size={14} /> : <Play size={14} />}
              {demo ? '暂停示例' : '播放示例'}
            </button>
          </SettingRow>
        </div>
      </section>
      <section className="preference-section" aria-labelledby="runtime-heading">
        <h2 id="runtime-heading">运行状态</h2>
        <div className="preference-card">
          <SettingRow title="当前系统">
            <span className="preference-value">{platform}</span>
          </SettingRow>
          <details className="diagnostic-details">
            <summary>
              功能状态
              <ChevronDown size={15} />
            </summary>
            <div className="diagnostic-status-list">
              <SettingRow title="文字翻译">
                <span className="preference-value">{desktop ? '待服务验证' : '需桌面应用'}</span>
              </SettingRow>
              <SettingRow title="语音合成">
                <span className="preference-value">{desktop ? '待服务验证' : '需桌面应用'}</span>
              </SettingRow>
              <SettingRow title="应用声音采集">
                <span className="preference-value">
                  {!runtime ? '读取中…' : runtime.nativeCapture ? '已接入，待实测' : '尚未接入'}
                </span>
              </SettingRow>
            </div>
          </details>
        </div>
      </section>
    </div>
  );
}
