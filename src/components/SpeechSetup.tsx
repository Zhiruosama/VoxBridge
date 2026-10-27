import { useEffect, useState } from 'react';
import { desktop, inspectSpeechOutput, virtualMicStatus } from '../bridge';
import { virtualMicrophoneOutputId } from '../core/audio-routing';
import { profileFor, validateProfile } from '../core/settings';
import type { OutputDevice, Settings, VirtualMicStatus } from '../core/types';
import { t } from '../i18n';

export default function SpeechSetup({
  settings,
  onSettings,
  onVirtual,
  onSource,
}: {
  settings: Settings;
  onSettings: (section: 'general' | 'translation' | 'tts') => void;
  onVirtual: () => void;
  onSource: () => void;
}) {
  const route = settings.composer.route;
  const id = route === 'send' ? settings.audio.sendDeviceId : settings.audio.previewDeviceId;
  const [state, setState] = useState<{
    id: string;
    output?: OutputDevice;
    mic?: VirtualMicStatus;
    error?: string;
  }>();
  useEffect(() => {
    let active = true;
    let pending = false;
    async function refresh() {
      if (!desktop || pending) return;
      pending = true;
      const [output, mic] = await Promise.allSettled([inspectSpeechOutput(id), virtualMicStatus()]);
      if (active)
        setState({
          id,
          ...(output.status === 'fulfilled'
            ? { output: output.value }
            : { error: String(output.reason).replace(/^Error: /, '') }),
          ...(mic.status === 'fulfilled' ? { mic: mic.value } : {}),
        });
      pending = false;
    }
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [id]);
  const current = state?.id === id ? state : undefined;
  const mic = current?.mic;
  const ready = !!mic?.output && !!mic.inputName && !mic.partial;
  const connected = ready && current?.output?.id === mic.output?.id;
  const missingTranslation =
    settings.composer.output === 'translation' &&
    !!validateProfile(profileFor(settings, 'translation'));
  const missingSpeech = !!validateProfile(profileFor(settings, 'tts'));
  return (
    <div className="speech-setup" aria-label={t('语音发送检查')}>
      <div className="speech-route-status">
        <span>
          {t(
            route === 'send' ? '发送到：{0}' : '试听到：{0}',
            current?.output?.name ?? t(current?.error ? '设备未就绪' : '检测中…'),
          )}
        </span>
        <button className="subtle" onClick={() => onSettings('general')}>
          {t('音频设置')}
        </button>
        {route === 'send' && ready && !connected && id !== virtualMicrophoneOutputId && (
          <button className="subtle" onClick={onVirtual}>
            {t('改用虚拟麦克风并保存')}
          </button>
        )}
      </div>
      {current?.error ? (
        <p role="status">{t(current.error)}</p>
      ) : (
        route === 'send' &&
        current?.output && (
          <p>
            {connected
              ? t('聊天软件的麦克风请选择：{0}', mic?.inputName ?? '')
              : t('当前发送设备不是 VoxBridge 虚拟麦克风，请确认聊天软件使用对应输入。')}
          </p>
        )
      )}
      {missingSpeech && (
        <p>
          <button className="subtle" onClick={() => onSettings('tts')}>
            {t('请先配置语音合成服务')}
          </button>
        </p>
      )}
      {missingTranslation && (
        <p>
          {t('译文发送尚未配置文字翻译服务。')}{' '}
          <button className="subtle" onClick={() => onSettings('translation')}>
            {t('配置文字翻译')}
          </button>{' '}
          <button className="subtle" onClick={onSource}>
            {t('改发原文并保存')}
          </button>
        </p>
      )}
      <p>
        {t(
          settings.composer.voiceInputMode === 'send'
            ? '录音结束后发送合成语音；不会直通麦克风原声。'
            : '录音后先填入文字，确认后点击发送；不会直通麦克风原声。',
        )}
      </p>
    </div>
  );
}
