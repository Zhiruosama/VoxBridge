import { SpeechEmotion } from './SpeechOptionsControls';
import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Volume2 } from 'lucide-react';
import Select from './Select';
import SpeechSpeed from './SpeechSpeed';
import { profileFor } from '../core/settings';
import {
  modelOptions,
  speechProvider,
  updateSpeechProfile,
  voiceOptions,
} from '../core/speech-presets';
import type { Settings } from '../core/types';

/** Quick changes affect the next synthesis. Listening owns an independent ASR snapshot. */
export default function SpeechPicker({
  settings,
  onChange,
  onSettings,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onSettings: () => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [voiceError, setVoiceError] = useState('');
  const profile = profileFor(settings, 'tts');
  const voices = voiceOptions(profile);
  const selected = voices.find((option) => option.value === profile.voice);
  const label = selected?.translate === false ? selected.label : t(selected?.label || '选择音色');
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        !details.current?.contains(target) &&
        !target.closest('.select-menu')
      )
        details.current?.removeAttribute('open');
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector('[role="listbox"]')
      ) {
        if (details.current?.open) {
          details.current.open = false;
          details.current.querySelector('summary')?.focus();
        }
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  return (
    <details ref={details} className="speech-picker">
      <summary aria-label={t('语音选项')} aria-description={t('切换语音模型与音色，不中断监听')}>
        <Volume2 size={14} />
        <span>{label}</span>
        <ChevronDown size={11} />
      </summary>
      <div className="speech-picker-panel" role="group" aria-label={t('语音选项')}>
        <label>{t('语音服务')}</label>
        <Select
          label={t('快捷语音服务')}
          value={profile.id}
          options={settings.profiles
            .filter((p) => p.stage === 'tts')
            .map((p) => ({
              value: p.id,
              label: p.name,
              translate: p.name === '空白配置' && !p.baseUrl,
              group: speechProvider(p),
            }))}
          onChange={(id) => onChange({ ...settings, active: { ...settings.active, tts: id } })}
        />
        <label>{t('模型')}</label>
        <Select
          label={t('快捷语音模型')}
          value={profile.modelId}
          placeholder={t('先配置语音服务')}
          options={modelOptions(profile)}
          onChange={(modelId) => onChange(updateSpeechProfile(settings, { modelId }))}
        />
        <label>{t('音色')}</label>
        <Select
          label={t('快捷音色')}
          value={profile.voice}
          placeholder={t('先配置音色')}
          options={voices}
          onChange={(voice) => {
            try {
              onChange(updateSpeechProfile(settings, { voice }));
              setVoiceError('');
            } catch (error) {
              setVoiceError(error instanceof Error ? error.message : String(error));
            }
          }}
        />
        {voiceError && (
          <p role="alert" className="error-text">
            {t(voiceError)}
          </p>
        )}
        {profile.adapter === 'minimax_tts_ws' && (
          <>
            <label>{t('情绪')}</label>
            <SpeechEmotion
              profile={profile}
              onChange={(speechOptions) =>
                onChange(updateSpeechProfile(settings, { speechOptions }))
              }
            />
          </>
        )}
        <label>{t('语速')}</label>
        <SpeechSpeed
          value={profile.speed}
          onChange={(speed) => onChange(updateSpeechProfile(settings, { speed }))}
        />
        <div className="speech-picker-bottom">
          <span>{t('下一次生成生效')}</span>
          <button
            className="subtle"
            onClick={() => {
              details.current?.removeAttribute('open');
              onSettings();
            }}
          >
            {t('更多设置')}
          </button>
        </div>
      </div>
    </details>
  );
}
