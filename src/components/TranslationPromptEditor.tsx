import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  builtinTranslationPromptPresets,
  customTranslationPromptPresetLimit,
  defaultTranslationPrompt,
  selectedTranslationPromptPresetId,
  translationPromptLimit,
  translationPromptPresetNameLimit,
  type TranslationPromptPreset,
} from '../core/translation-prompt';
import type { ProviderProfile } from '../core/types';
import { t } from '../i18n';
import Select from './Select';

export default function TranslationPromptEditor({
  profile,
  presets,
  onPromptChange,
  onSavePreset,
  onDeletePreset,
}: {
  profile: ProviderProfile;
  presets: TranslationPromptPreset[];
  onPromptChange: (prompt: string, presetId?: string) => void;
  onSavePreset: (entry: TranslationPromptPreset) => void;
  onDeletePreset: (id: string) => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState('');
  const prompt = profile.translationPrompt ?? defaultTranslationPrompt;
  const selection = selectedTranslationPromptPresetId(profile, presets);
  const options = [
    ...builtinTranslationPromptPresets.map((preset) => ({
      value: preset.id,
      label: preset.name,
      group: t('内置提示词预设'),
    })),
    ...presets.map((preset) => ({
      value: preset.id,
      label: preset.name,
      group: t('自建提示词预设'),
      translate: false,
    })),
  ];

  function closeForm() {
    setName(null);
    setError('');
  }

  return (
    <section className="preference-section" aria-labelledby="translation-prompt-heading">
      <div className="preference-section-title">
        <h2 id="translation-prompt-heading">{t('翻译风格')}</h2>
        <button
          className="subtle"
          disabled={name !== null}
          onClick={() => onPromptChange(defaultTranslationPrompt)}
        >
          {t('恢复默认')}
        </button>
      </div>
      <div className="preference-card translation-prompt-editor">
        <div className="translation-prompt-content">
          <div className="translation-prompt-toolbar">
            <Select
              label={t('提示词预设')}
              value={selection ?? ''}
              placeholder="自定义提示词"
              options={options}
              disabled={name !== null}
              onChange={(value) => {
                const custom = presets.find((preset) => preset.id === value);
                const preset =
                  custom ?? builtinTranslationPromptPresets.find((item) => item.id === value);
                if (preset) onPromptChange(preset.prompt, custom?.id);
              }}
            />
            <button
              className="subtle"
              disabled={
                name !== null ||
                !prompt.trim() ||
                presets.length >= customTranslationPromptPresetLimit
              }
              onClick={() => setName('')}
            >
              {t('保存为预设')}
            </button>
          </div>
          {name !== null && (
            <form
              className="translation-prompt-form"
              aria-label={t('保存为预设')}
              onSubmit={(event) => {
                event.preventDefault();
                try {
                  onSavePreset({ id: `custom:${crypto.randomUUID()}`, name, prompt });
                  closeForm();
                } catch (failure) {
                  setError(failure instanceof Error ? failure.message : String(failure));
                }
              }}
            >
              <input
                aria-label={t('提示词预设名称')}
                placeholder={t('提示词预设名称')}
                value={name}
                maxLength={translationPromptPresetNameLimit}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
              {error && (
                <p className="preset-editor-error" role="alert">
                  {t(error)}
                </p>
              )}
              <div className="preset-editor-actions">
                <span>{t('完成后点击右上角保存更改')}</span>
                <button type="button" className="subtle" onClick={closeForm}>
                  {t('取消')}
                </button>
                <button type="submit" disabled={!name.trim() || !prompt.trim()}>
                  {t('完成')}
                </button>
              </div>
            </form>
          )}
          <textarea
            aria-label={t('翻译前置 Prompt')}
            value={prompt}
            maxLength={translationPromptLimit}
            rows={8}
            spellCheck={false}
            placeholder={defaultTranslationPrompt}
            onChange={(event) => onPromptChange(event.target.value)}
          />
          <p className="translation-prompt-help">
            {t(
              '提示词同时用于实时字幕和输入文字的翻译。目标语言由语言设置决定，留空使用默认提示词。',
            )}
          </p>
          {presets.length > 0 && (
            <details className="translation-prompt-library">
              <summary>{t('管理自建预设')}</summary>
              <ul>
                {presets.map((preset) => (
                  <li key={preset.id}>
                    <span>{preset.name}</span>
                    <button
                      className="icon-button"
                      aria-label={t('删除提示词预设 {0}', preset.name)}
                      onClick={() => onDeletePreset(preset.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
