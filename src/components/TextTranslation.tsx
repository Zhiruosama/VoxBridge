import { useState, useSyncExternalStore } from 'react';
import { ArrowRight, Check, Copy, LoaderCircle, Settings2, X } from 'lucide-react';
import type { TextTranslationController } from '../core/text-translation';
import { profileFor } from '../core/settings';
import type { Settings } from '../core/types';
import { t } from '../i18n';
import Select from './Select';

const languages = [
  '英语',
  '简体中文',
  '日语',
  '韩语',
  '西班牙语',
  '印尼语',
  '粤语',
  '芬兰语',
  '俄语',
  '德语',
];
export default function TextTranslation({
  controller,
  settings,
  onSettings,
}: {
  controller: TextTranslationController;
  settings: Settings;
  onSettings: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState(false);
  const profile = profileFor(settings, 'translation');
  const options = languages.map((label) => ({ label, value: label }));
  const submit = () => void controller.submit(profile);
  return (
    <section className="text-translation" aria-label={t('文本翻译')}>
      <div className="text-translation-toolbar">
        <div className="text-translation-direction">
          <Select
            label="原文语言"
            value={state.source}
            options={[{ value: '自动识别', label: '自动识别' }, ...options]}
            onChange={(source) => controller.update({ source })}
          />
          <ArrowRight size={16} aria-hidden="true" />
          <Select
            label="目标语言"
            value={state.target}
            options={options}
            onChange={(target) => controller.update({ target })}
          />
        </div>
        <button className="subtle" onClick={onSettings}>
          <Settings2 size={14} aria-hidden="true" />
          {t('翻译设置')}
        </button>
      </div>
      <div className="text-translation-panels">
        <div className="text-translation-panel">
          <label htmlFor="text-translation-input">{t('原文')}</label>
          <textarea
            id="text-translation-input"
            value={state.input}
            placeholder={t('输入要翻译的文字…')}
            onChange={(event) => controller.update({ input: event.target.value })}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                (event.metaKey || event.ctrlKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="text-translation-footer">
            <span className={[...state.input].length > 2000 ? 'error' : ''}>
              {[...state.input].length} / 2000
            </span>
            <div>
              <button
                className="subtle"
                onClick={controller.clear}
                disabled={!state.input && !state.result && !state.busy}
              >
                {t('清空')}
              </button>
              {state.busy ? (
                <button onClick={controller.cancel}>
                  <X size={14} />
                  {t('取消')}
                </button>
              ) : (
                <button onClick={submit} disabled={!state.input.trim()}>
                  {t('翻译')}
                  <ArrowRight size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="text-translation-panel" aria-busy={state.busy}>
          <div className="text-translation-result-heading">
            <span>
              {t('译文')}
              {state.resultTarget && (
                <span className="text-translation-language"> · {t(state.resultTarget)}</span>
              )}
            </span>
            <button
              className="icon-button"
              aria-label={t('复制译文')}
              disabled={!state.result}
              onClick={() => {
                setCopyError(false);
                void navigator.clipboard
                  .writeText(state.result)
                  .then(() => setCopied(state.result))
                  .catch(() => setCopyError(true));
              }}
            >
              {copied && copied === state.result ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <div
            className={`text-translation-result ${state.result ? '' : 'text-translation-placeholder'}`}
            data-selection-scope
          >
            {state.result || t('译文将显示在这里')}
          </div>
          <div className="text-translation-footer" role="status">
            {state.busy ? (
              <span className="text-translation-progress">
                <LoaderCircle size={14} className="status-spinner" />
                {t('翻译中…')}
              </span>
            ) : (
              <span>{profile.name}</span>
            )}
            {copyError && <span>{t('复制失败，请手动选择译文复制。')}</span>}
          </div>
        </div>
      </div>
      {state.error && (
        <div className="text-translation-error" role="alert">
          {t(state.error)}
        </div>
      )}
    </section>
  );
}
