import type { CSSProperties } from 'react';
import { t } from '../i18n';
import type { ProviderProfile } from '../core/types';
import {
  speechOptions,
  speechOptionDefaults,
  emotionOptions,
  soundEffects,
  type SpeechOptions,
} from '../core/speech-options';
import Select from './Select';
import SettingRow from './SettingRow';

export function SpeechEmotion({
  profile,
  onChange,
}: {
  profile: ProviderProfile;
  onChange: (options: SpeechOptions) => void;
}) {
  const options = speechOptions(profile);
  return (
    <Select
      label={t('语音情绪')}
      value={options.emotion}
      options={emotionOptions(profile.modelId)}
      onChange={(emotion) => onChange({ ...options, emotion: emotion as SpeechOptions['emotion'] })}
    />
  );
}

export default function SpeechOptionsControls({
  profile,
  onChange,
}: {
  profile: ProviderProfile;
  onChange: (change: Partial<ProviderProfile>) => void;
}) {
  if (profile.adapter !== 'minimax_tts_ws') return null;
  const options = speechOptions(profile);
  const update = (change: Partial<SpeechOptions>) =>
    onChange({ speechOptions: { ...options, ...change } });
  function slider(
    key: 'volume' | 'pitch' | 'effectPitch' | 'intensity' | 'timbre',
    label: string,
    min: number,
    max: number,
    step = 1,
  ) {
    const value = options[key];
    return (
      <SettingRow title={t(label)} key={key}>
        <div
          className="speech-speed-control"
          style={{ '--range-progress': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
        >
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-label={t(label)}
            onChange={(event) => update({ [key]: Number(event.target.value) })}
          />
          <output>
            {key === 'volume' ? `${value.toFixed(1)}×` : value > 0 ? `+${value}` : value}
          </output>
        </div>
      </SettingRow>
    );
  }
  return (
    <section className="preference-section" aria-labelledby="speech-expression-heading">
      <div className="preference-section-title">
        <h2 id="speech-expression-heading">{t('语音表达')}</h2>
        <button
          className="subtle"
          onClick={() => onChange({ speechOptions: structuredClone(speechOptionDefaults) })}
        >
          {t('恢复默认')}
        </button>
      </div>
      <div className="preference-card">
        <SettingRow title={t('情绪')}>
          <SpeechEmotion
            profile={profile}
            onChange={(speechOptions) => onChange({ speechOptions })}
          />
        </SettingRow>
        {slider('volume', '音量', 0.1, 10, 0.1)}
        {slider('pitch', '音调', -12, 12)}
      </div>
      <details className="speech-advanced">
        <summary>{t('高级声音设置')}</summary>
        <div className="preference-card">
          {slider('effectPitch', '音高效果 · 低沉 / 明亮', -100, 100)}
          {slider('intensity', '声音力度 · 刚劲 / 轻柔', -100, 100)}
          {slider('timbre', '音色质感 · 浑厚 / 清脆', -100, 100)}
          <SettingRow title={t('音效')}>
            <Select
              label={t('语音音效')}
              value={options.soundEffect}
              options={Object.entries(soundEffects).map(([value, label]) => ({ value, label }))}
              onChange={(soundEffect) =>
                update({ soundEffect: soundEffect as SpeechOptions['soundEffect'] })
              }
            />
          </SettingRow>
          <div className="speech-pronunciation">
            <label htmlFor="speech-pronunciation">{t('发音替换')}</label>
            <textarea
              id="speech-pronunciation"
              value={options.pronunciation.join('\n')}
              spellCheck={false}
              placeholder={'VoxBridge/vox bridge\n处理/(chu3)(li3)'}
              maxLength={15000}
              onChange={(event) => update({ pronunciation: event.target.value.split('\n') })}
            />
            <p>{t('每行填写原词/读法，最多 50 行。')}</p>
          </div>
        </div>
        <p className="speech-markup-help">
          {t(
            '原文输出时，可在文本中使用 <#0.5#> 停顿半秒，(chuckle) 轻笑或 (sighs) 叹气。翻译模式不会保证保留这些标记。',
          )}
        </p>
      </details>
    </section>
  );
}
