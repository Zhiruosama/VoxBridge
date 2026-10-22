import { useEffect, useState } from 'react';
import { AudioLines, RefreshCw, Square, Volume2 } from 'lucide-react';
import { desktop, listOutputs, stopTone, testTone } from '../bridge';
import type { OutputDevice, RuntimeInfo } from '../core/types';
import Select from './Select';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const next = await listOutputs();
      setDevices(next);
      setDeviceId('');
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      void stopTone();
    };
  }, []);
  async function play() {
    setBusy(true);
    setError('');
    try {
      await testTone(deviceId);
      notify('测试结束，请根据实际听到或回录的声音判断路由。');
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="content-page diagnostics-page">
      <div className="page-heading">
        <div>
          <h1>音频与诊断</h1>
          <p>逐步检查输出设备，再进行 Mac 原生采集联调。</p>
        </div>
        <AudioLines size={28} strokeWidth={1} />
      </div>
      <section className="settings-section">
        <div className="section-heading">
          <div>
            <h2>字幕演示</h2>
            <p>固定样例，不录音、不调用模型服务。</p>
          </div>
          <button onClick={onDemo}>{demo ? '暂停演示' : '播放演示'}</button>
        </div>
      </section>
      <section className="settings-section">
        <div className="section-heading">
          <div>
            <h2>运行环境</h2>
            <p>{runtime?.message ?? '正在读取运行环境…'}</p>
          </div>
          <span className="tag">{runtime?.platform ?? '加载中'}</span>
        </div>
        <div className="checklist">
          <p>
            <span>工作台与演示字幕</span>
            <strong>可使用</strong>
          </p>
          <p>
            <span>真实文字翻译</span>
            <strong>{desktop ? '配置密钥后测试' : '需桌面版'}</strong>
          </p>
          <p>
            <span>系统应用声音采集</span>
            <strong>待 Mac 实机接入</strong>
          </p>
          <p>
            <span>语音合成与虚拟麦克风发送</span>
            <strong>接入中</strong>
          </p>
        </div>
      </section>
      <section className="settings-section">
        <div className="section-heading">
          <div>
            <h2>输出路由测试</h2>
            <p>显式播放约 1 秒、低音量的 440 Hz 测试音。选择 BlackHole 时声音可能进入通话。</p>
          </div>
          <button onClick={() => void refresh()} disabled={!desktop || loading || busy}>
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
        <label>
          测试目的地
          <Select
            label="测试目的地"
            value={deviceId}
            onChange={setDeviceId}
            disabled={!desktop || loading || busy}
            placeholder="请选择设备，不自动跟随系统默认值"
            options={[
              ...new Map(
                devices.map((device) => [device.id, { value: device.id, label: device.name }]),
              ).values(),
            ]}
          />
        </label>
        {!desktop && <p className="muted">浏览器预览不访问原生音频设备。</p>}
        <div className="test-actions">
          <button onClick={() => void play()} disabled={!deviceId || busy}>
            <Volume2 size={15} />
            {busy ? '正在测试…' : '向所选设备播放测试音'}
          </button>
          <button
            onClick={() => void stopTone().catch((error) => setError(String(error)))}
            disabled={!busy}
          >
            <Square size={13} />
            停止
          </button>
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <small>
          诊断版暂按设备名称匹配，同名设备会拒绝播放。正式路由的稳定 UID、断连恢复仍待实现。
        </small>
      </section>
      <section className="settings-section">
        <h2>明日 Mac 联调顺序</h2>
        <ol className="steps">
          <li>构建并运行桌面应用，检查 Keychain 保存。</li>
          <li>使用原生探针确认目标应用声音与权限。</li>
          <li>安装 BlackHole，测试本地回录和 Discord 输入。</li>
          <li>同时收发，检查自身声音是否形成回环。</li>
        </ol>
      </section>
    </div>
  );
}
