import { useEffect, useRef, useState } from 'react';
import { Square } from 'lucide-react';
import { desktop, stopAsr, transcribeWav } from '../bridge';
import { profileFor, validateProfile } from '../core/settings';
import type { Settings, Transcript } from '../core/types';
import SettingRow from './SettingRow';

export default function AsrDiagnostic({ settings }: { settings: Settings }) {
  const profile = profileFor(settings, 'asr');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Transcript | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const requestRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const id = requestRef.current;
      requestRef.current = null;
      if (id) void stopAsr(id).catch(() => {});
    };
  }, []);

  async function run() {
    if (!file || requestRef.current) return;
    const invalid = validateProfile(profile);
    if (invalid) {
      setError(`${invalid} 请到语音识别设置完善配置。`);
      return;
    }
    if (file.size > 1_000_000 || file.size < 44) {
      setError('请选择小于 1 MB 的短 WAV 音频。');
      return;
    }
    const id = crypto.randomUUID();
    requestRef.current = id;
    stoppedRef.current = false;
    setBusy(true);
    setResult(null);
    setError('');
    try {
      const audio = new Uint8Array(await file.arrayBuffer());
      if (!mountedRef.current || requestRef.current !== id || stoppedRef.current) return;
      const transcript = await transcribeWav(profile, audio, id);
      if (mountedRef.current && requestRef.current === id && !stoppedRef.current)
        setResult(transcript);
    } catch (error) {
      if (mountedRef.current && requestRef.current === id && !stoppedRef.current)
        setError(String(error));
    } finally {
      if (requestRef.current === id) {
        requestRef.current = null;
        if (mountedRef.current) {
          setBusy(false);
          setStopping(false);
        }
      }
    }
  }

  async function stop() {
    const id = requestRef.current;
    if (!id || stoppedRef.current) return;
    stoppedRef.current = true;
    setStopping(true);
    try {
      await stopAsr(id);
    } catch (error) {
      if (mountedRef.current && requestRef.current === id) {
        setError(String(error));
        stoppedRef.current = false;
        setStopping(false);
      }
    }
  }

  return (
    <section className="preference-section" aria-labelledby="asr-test-heading">
      <h2 id="asr-test-heading">ASR 短音频验证</h2>
      <div className="preference-card">
        <SettingRow title="当前识别配置">
          <span className="preference-value">
            {profile.name} · {profile.modelId || '未配置模型'}
          </span>
        </SettingRow>
        <SettingRow title="测试音频">
          <input
            aria-label="ASR 测试 WAV 文件"
            type="file"
            accept=".wav,audio/wav"
            disabled={!desktop || busy || profile.adapter !== 'qwen_chat_asr'}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setResult(null);
              setError('');
            }}
          />
        </SettingRow>
        <SettingRow title="识别测试">
          {busy ? (
            <button onClick={() => void stop()} disabled={stopping}>
              <Square size={14} />
              {stopping ? '正在停止…' : '停止识别'}
            </button>
          ) : (
            <button
              onClick={() => void run()}
              disabled={!desktop || !file || profile.adapter !== 'qwen_chat_asr'}
            >
              发送音频并识别
            </button>
          )}
        </SettingRow>
        {result && (
          <SettingRow title="识别结果">
            <span className="preference-value" role="status">
              {result.text || '未识别到文字'} · {result.audioSeconds.toFixed(2)} 秒
            </span>
          </SettingRow>
        )}
      </div>
      <p
        className={`diagnostic-feedback${error ? ' error-text' : ''}`}
        role={error ? 'alert' : 'status'}
      >
        {error ||
          (profile.adapter === 'qwen_dashscope_asr'
            ? '实时识别请回到字幕页，选择音频进程后开始监听。'
            : '支持 0.1–30 秒、16 kHz 单声道 PCM16 WAV。点击后会将所选音频发送给当前 ASR 服务，可能计费；不保存音频或文本。此入口不是实时 WebSocket 识别。')}
      </p>
    </section>
  );
}
