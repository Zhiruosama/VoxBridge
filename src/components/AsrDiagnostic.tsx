import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { FileAudio, FolderOpen, Square } from 'lucide-react';
import { desktop, stopAsr, transcribeWav } from '../bridge';
import { profileFor, validateProfile } from '../core/settings';
import { usesBuiltinProfileName } from '../core/provider-presets';
import type { Settings, Transcript } from '../core/types';
import SettingRow from './SettingRow';

export default function AsrDiagnostic({ settings }: { settings: Settings }) {
  const profile = profileFor(settings, 'asr');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<Transcript | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const supportsFile = ['qwen_chat_asr', 'openai_audio_transcriptions'].includes(profile.adapter);
  const fileDisabled = !desktop || busy || !supportsFile;
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
      setError(t('{0} 请到语音识别设置完善配置。', invalid));
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
      <h2 id="asr-test-heading">{t('ASR 短音频验证')}</h2>
      <div className="preference-card">
        <SettingRow title={t('当前识别配置')}>
          <div className="asr-profile-summary">
            <div className="asr-profile-heading">
              <span className="asr-profile-name">
                {usesBuiltinProfileName(profile) ? t(profile.name) : profile.name}
              </span>
              <span className="protocol-value">
                {profile.adapter === 'qwen_dashscope_asr' ? 'WebSocket' : 'HTTP'}
              </span>
            </div>
            <span className="asr-profile-model">{profile.modelId || t('未配置模型')}</span>
          </div>
        </SettingRow>
        <SettingRow title={t('测试音频')}>
          <div className="asr-file-picker">
            <FileAudio size={18} aria-hidden="true" />
            <div className="asr-file-details">
              <span className="asr-file-name">{file?.name || t('未选择文件')}</span>
              <span className="asr-file-format">
                WAV · {file ? `${(file.size / 1000).toFixed(1)} KB` : '≤ 1 MB'}
              </span>
            </div>
            <button type="button" disabled={fileDisabled} onClick={() => fileRef.current?.click()}>
              <FolderOpen size={14} aria-hidden="true" />
              {t(file ? '更换文件' : '选择文件')}
            </button>
            <input
              ref={fileRef}
              hidden
              aria-label={t('ASR 测试 WAV 文件')}
              type="file"
              accept=".wav,audio/wav"
              disabled={fileDisabled}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setResult(null);
                setError('');
              }}
            />
          </div>
        </SettingRow>
        <SettingRow title={t('识别测试')}>
          {busy ? (
            <button onClick={() => void stop()} disabled={stopping}>
              <Square size={14} />
              {t(stopping ? '正在停止…' : '停止识别')}
            </button>
          ) : (
            <button onClick={() => void run()} disabled={!desktop || !file || !supportsFile}>
              {t('发送音频并识别')}
            </button>
          )}
        </SettingRow>
        {result && (
          <SettingRow title={t('识别结果')}>
            <span className="preference-value" role="status">
              {t(result.text || '未识别到文字')} · {result.audioSeconds.toFixed(2)} {t('秒')}
            </span>
          </SettingRow>
        )}
      </div>
      <p
        className={`diagnostic-feedback${error ? ' error-text' : ''}`}
        role={error ? 'alert' : 'status'}
      >
        {t(
          error ||
            (profile.adapter === 'qwen_dashscope_asr'
              ? '实时识别请回到字幕页，选择音频进程后开始监听。'
              : '支持 0.1–30 秒、16 kHz 单声道 PCM16 WAV。点击后会将所选音频发送给当前 ASR 服务，可能计费；不保存音频或文本。此入口不是实时 WebSocket 识别。'),
        )}
      </p>
    </section>
  );
}
