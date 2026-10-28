import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, X } from 'lucide-react';
import type { ProviderProfile } from '../core/types';
import { probeService } from '../core/service-probe';
import { RequestTask } from '../core/request-task';
import { recoveryHint } from '../core/operation-feedback';
import {
  credentialStatus,
  translate,
  cancelTranslation,
  prepareSpeech,
  discardPreparedSpeech,
  desktop,
} from '../bridge';
import { t } from '../i18n';

/** No microphone or playback: speech tests generate a tiny disposable audio buffer. */
export default function ServiceCheck({
  profile,
  hasUnsavedKey,
  onDiagnostics,
}: {
  profile: ProviderProfile;
  hasUnsavedKey: boolean;
  onDiagnostics: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'busy' | 'success' | 'failed'>('idle');
  const [message, setMessage] = useState('');
  const running = useRef<{ task: RequestTask; id: string } | null>(null);
  useEffect(
    () => () => {
      running.current?.task.cancel();
      running.current = null;
    },
    [],
  );
  function cancel() {
    running.current?.task.cancel();
    running.current = null;
    setStatus('idle');
    setMessage('操作已取消。');
  }
  async function check() {
    if (running.current) return;
    const id = crypto.randomUUID();
    const snapshot = structuredClone(profile);
    const stop = () =>
      snapshot.stage === 'tts' ? discardPreparedSpeech(id) : cancelTranslation(id);
    const task = new RequestTask(stop);
    running.current = { task, id };
    setStatus('busy');
    setMessage('');
    try {
      const result = await probeService(snapshot, hasUnsavedKey, id, task, {
        credentialStatus,
        translate,
        prepareSpeech,
        discardPreparedSpeech,
      });
      if (running.current?.id !== id) return;
      setStatus('success');
      setMessage(result);
    } catch (error) {
      if (running.current?.id !== id) return;
      setStatus('failed');
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (running.current?.id === id) running.current = null;
    }
  }
  return (
    <section className="preference-section service-check" aria-label={t('服务测试')}>
      <h2>{t('服务测试')}</h2>
      <div className="preference-card service-check-card">
        <div className="service-check-main">
          <p>
            {t(
              profile.stage === 'asr'
                ? '这里只检查配置和密钥，不录音，也不申请麦克风权限。'
                : profile.stage === 'tts'
                  ? '生成一句简短测试语音，可能计费；不会播放或发送到通话。'
                  : '发送一句简短翻译测试，可能计费；使用当前配置与已保存的密钥。',
            )}
          </p>
          <div className="service-check-actions">
            {profile.stage === 'asr' && (
              <button className="subtle" onClick={onDiagnostics}>
                {t('打开音频诊断')}
              </button>
            )}
            {status === 'busy' ? (
              <button onClick={cancel}>
                <X size={14} />
                {t('取消')}
              </button>
            ) : (
              <button onClick={() => void check()} disabled={!desktop}>
                {t(profile.stage === 'asr' ? '检查配置' : '测试连接')}
              </button>
            )}
          </div>
        </div>
        {(status !== 'idle' || message) && (
          <div className="service-check-feedback">
            {status === 'busy' && (
              <p role="status">
                <LoaderCircle size={14} className="status-spinner" />
                {t('正在测试服务，可随时取消…')}
              </p>
            )}
            {status === 'success' && (
              <p role="status" className="service-check-success">
                <Check size={14} />
                {t(message)}
              </p>
            )}
            {status === 'failed' && (
              <div role="alert">
                <p>{t(recoveryHint(message))}</p>
                <details>
                  <summary>{t('错误详情')}</summary>
                  <p>{t(message)}</p>
                </details>
              </div>
            )}
            {status === 'idle' && message && <p role="status">{t(message)}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
