import ServiceCheck from './ServiceCheck';
import BilingualToggle from './BilingualToggle';
import SpeechOptionsControls from './SpeechOptionsControls';
import { t, useUiLanguage } from '../i18n';
import SpeechSpeed from './SpeechSpeed';
import { useEffect, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { ArrowUpRight, ChevronDown, Check, Pencil, RefreshCw, Save, Trash2 } from 'lucide-react';
import { version } from '../../package.json';
import type { OutputDevice, ProviderProfile, Settings, Stage } from '../core/types';
import { defaultTranslationPrompt, translationPromptLimit } from '../core/translation-prompt';
import { blankProfile, profileFor, captionColorDefaults, defaults } from '../core/settings';
import {
  previewDeviceOptions,
  sendDeviceOptions,
  migrateLegacyOutputRouting,
} from '../core/audio-routing';
import {
  credentialStatus,
  desktop,
  listOutputs,
  listInputs,
  removeCredential,
  setCredential,
} from '../bridge';
import { subtitleDefaults } from '../core/overlay';
import { textOverlayAppearanceDefaults } from '../core/text-overlay';
import CaptionColorPicker from './CaptionColorPicker';
import Select from './Select';
import SettingRow from './SettingRow';
import VirtualMicrophone from './VirtualMicrophone';
import MicrophoneAccess from './MicrophoneAccess';
import UpdateControls from './UpdateControls';
import PresetEditor from './PresetEditor';
import PresetSelect from './PresetSelect';
import {
  applyProviderPreset,
  providerPresets,
  removeProviderProfile,
  usesBuiltinProfileName,
} from '../core/provider-presets';
import {
  modelOptions,
  voiceOptions,
  speechProvider,
  speechModelChange,
  selectSpeechVoice,
} from '../core/speech-presets';

export type SettingsSection = 'general' | Stage;
const sectionTitles: Record<SettingsSection, string> = {
  general: '常规',
  translation: '文字翻译',
  asr: '语音识别',
  tts: '语音合成',
};

export default function SettingsPanel({
  settings,
  savedSettings,
  onDraftChange,
  onAutomaticUpdatesChange,
  onSave,
  notify,
  onDiagnostics,
  onRefreshApplications,
  refreshingApplications,
  captureSupported,
  section,
  onBusyChange,
  onUnsavedKeyChange,
  focusSection,
  platform,
}: {
  platform?: string;
  settings: Settings;
  savedSettings: Settings;
  onDraftChange: Dispatch<SetStateAction<Settings>>;
  onAutomaticUpdatesChange: (enabled: boolean) => void;
  onSave: (settings: Settings) => void;
  notify: (message: string) => void;
  onDiagnostics: () => void;
  onRefreshApplications: () => Promise<void>;
  refreshingApplications: boolean;
  captureSupported: boolean;
  section: SettingsSection;
  onBusyChange: (busy: boolean) => void;
  onUnsavedKeyChange: (dirty: boolean) => void;
  focusSection?: { id: string; version: number } | null;
}) {
  const draft = settings;
  const setDraft = onDraftChange;
  const stage: Stage = section === 'general' ? 'translation' : section;
  useUiLanguage();
  const profile = profileFor(draft, stage);
  const [secret, setSecret] = useState('');
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyError, setKeyError] = useState('');
  useEffect(() => {
    onUnsavedKeyChange(Boolean(secret.trim()));
    return () => onUnsavedKeyChange(false);
  }, [secret, onUnsavedKeyChange]);
  const [renaming, setRenaming] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState<string | null>(null);
  const [previousName, setPreviousName] = useState('');
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const [inputs, setInputs] = useState<OutputDevice[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (!focusSection?.id) return;
    const heading = document.getElementById(focusSection.id);
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
  }, [focusSection]);
  async function refreshDevices() {
    setRefreshing(true);
    try {
      const [outputs, microphones] = await Promise.all([listOutputs(), listInputs()]);
      setDevices(outputs);
      setInputs(microphones);
      setDraft((current) => {
        const audio = migrateLegacyOutputRouting(current.audio, outputs);
        return audio === current.audio ? current : { ...current, audio };
      });
    } catch (error) {
      notify(String(error));
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    if (section !== 'general') return;
    let active = true;
    Promise.all([listOutputs(), listInputs()])
      .then(([next, microphones]) => {
        if (active) {
          setDevices(next);
          setInputs(microphones);
          setDraft((current) => {
            const audio = migrateLegacyOutputRouting(current.audio, next);
            return audio === current.audio ? current : { ...current, audio };
          });
        }
      })
      .catch((error) => {
        if (active) notify(String(error));
      });
    return () => {
      active = false;
    };
  }, [section]);
  useEffect(() => {
    let active = true;
    setSecret('');
    setHasKey(null);
    setKeyError('');
    setRenaming(false);
    setDeletingProfile(null);
    if (section === 'general') return;
    credentialStatus(profile.id)
      .then((exists) => {
        if (active) {
          setHasKey(exists);
        }
      })
      .catch((error) => {
        if (active) {
          setHasKey(false);
          setKeyError(String(error));
        }
      });
    return () => {
      active = false;
    };
  }, [profile.id, section]);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  function update(change: Partial<ProviderProfile>) {
    setDraft((current) => ({
      ...current,
      profiles: current.profiles.map((p) => (p.id === profile.id ? { ...p, ...change } : p)),
    }));
  }
  async function refreshKeyState() {
    setHasKey(await credentialStatus(profile.id));
  }
  async function saveKey(mode: 'saved' | 'clear' = 'saved') {
    setBusy(true);
    setKeyError('');
    try {
      if (mode === 'clear') await removeCredential(profile.id);
      else {
        await setCredential(profile.id, secret);
        onSave(draft);
      }
      setSecret('');
      await refreshKeyState();
      notify(mode === 'clear' ? '已移除保存的密钥。' : '密钥已保存，下次启动自动可用。');
    } catch (error) {
      setKeyError(String(error));
      await refreshKeyState().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  function addProfile() {
    if (draft.profiles.length >= 30) {
      notify('配置数量已达上限。');
      return;
    }
    const id = crypto.randomUUID();
    const next = blankProfile(stage, id);
    setDraft({
      ...draft,
      profiles: [...draft.profiles, next],
      active: { ...draft.active, [stage]: id },
    });
  }

  async function deleteCurrentProfile() {
    if (busy || deletingProfile !== profile.id) return;
    setBusy(true);
    try {
      const next = removeProviderProfile(draft, profile.id, crypto.randomUUID());
      await removeCredential(profile.id);
      setSecret('');
      setDeletingProfile(null);
      onSave(next);
      notify('配置及已保存的密钥已删除。');
    } catch (error) {
      notify(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveCurrent() {
    if (secret.trim()) {
      setBusy(true);
      setKeyError('');
      try {
        await setCredential(profile.id, secret);
        setSecret('');
        await refreshKeyState();
        onSave(draft);
      } catch (error) {
        setKeyError(String(error));
      } finally {
        setBusy(false);
      }
    } else onSave(draft);
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedSettings) || Boolean(secret.trim());
  return (
    <div className="settings-page preferences-page">
      <header className="preferences-heading">
        <div className="preferences-title">
          <h1>{t(sectionTitles[section])}</h1>
        </div>
        <div className="preferences-save">
          {dirty && <span role="status">{t('未保存')}</span>}
          <button
            disabled={busy || !dirty || (renaming && !profile.name.trim())}
            onClick={() => void saveCurrent()}
          >
            <Save size={14} />
            {t('保存更改')}
          </button>
        </div>
      </header>
      {section === 'general' ? (
        <>
          <section className="preference-section" aria-labelledby="appearance-heading">
            <h2 id="appearance-heading">{t('外观')}</h2>
            <div className="preference-card">
              <SettingRow title={t('界面语言')}>
                <Select
                  label={t('界面语言')}
                  value={draft.uiLanguage}
                  options={[
                    { value: 'zh-CN', label: '简体中文' },
                    { value: 'en', label: 'English' },
                    { value: 'ru', label: 'Русский' },
                  ]}
                  onChange={(value) =>
                    setDraft({ ...draft, uiLanguage: value as Settings['uiLanguage'] })
                  }
                />
              </SettingRow>
              <SettingRow title={t('主题')}>
                <Select
                  label={t('主题')}
                  value={draft.theme}
                  onChange={(value) => setDraft({ ...draft, theme: value as Settings['theme'] })}
                  options={[
                    { value: 'dark', label: '深色' },
                    { value: 'light', label: '浅色' },
                    { value: 'system', label: '跟随系统' },
                  ]}
                />
              </SettingRow>
              {(platform === 'macos' || platform === 'windows') && (
                <SettingRow title={t('关闭主窗口时')}>
                  <Select
                    label={t('关闭主窗口时')}
                    value={draft.mainWindowCloseBehavior}
                    options={[
                      {
                        value: 'hide',
                        label: platform === 'windows' ? '最小化到系统托盘' : '隐藏到后台',
                      },
                      { value: 'quit', label: '退出应用' },
                    ]}
                    onChange={(value) =>
                      setDraft({
                        ...draft,
                        mainWindowCloseBehavior: value as Settings['mainWindowCloseBehavior'],
                      })
                    }
                  />
                </SettingRow>
              )}
              <SettingRow title={t('文本翻译面板不透明度')}>
                <input
                  type="range"
                  aria-label={t('文本翻译面板不透明度')}
                  min={0}
                  max={100}
                  step={1}
                  value={draft.textTranslationOpacity}
                  onChange={(event) =>
                    setDraft({ ...draft, textTranslationOpacity: Number(event.target.value) })
                  }
                />
                <span className="preference-value">{draft.textTranslationOpacity}%</span>
              </SettingRow>
              <SettingRow title={t('字幕显示方式')}>
                <Select
                  label={t('字幕显示方式')}
                  value={draft.captionLayout}
                  options={[
                    { value: 'sentence', label: '逐句' },
                    { value: 'paragraph', label: '自然段' },
                  ]}
                  onChange={(value) =>
                    setDraft({ ...draft, captionLayout: value as Settings['captionLayout'] })
                  }
                />
              </SettingRow>
              <SettingRow title={t('字幕段落间距')}>
                <input
                  type="range"
                  aria-label={t('字幕段落间距')}
                  min={8}
                  max={64}
                  step={1}
                  value={draft.captionSpacing}
                  onChange={(event) =>
                    setDraft({ ...draft, captionSpacing: Number(event.target.value) })
                  }
                />
                <span className="preference-value">{draft.captionSpacing} px</span>
              </SettingRow>
            </div>
          </section>
          <section className="preference-section" aria-labelledby="caption-colors-heading">
            <div className="preference-section-title">
              <h2 id="caption-colors-heading">{t('工作台字幕')}</h2>
              <button
                onClick={() =>
                  setDraft({
                    ...draft,
                    captionFontSize: defaults.captionFontSize,
                    captionColors: { ...captionColorDefaults },
                  })
                }
              >
                {t('恢复默认')}
              </button>
            </div>
            <div className="preference-card">
              <SettingRow title={t('字号')}>
                <input
                  type="range"
                  aria-label={t('工作台字幕字号')}
                  min={12}
                  max={32}
                  step={1}
                  value={draft.captionFontSize}
                  onChange={(event) =>
                    setDraft({ ...draft, captionFontSize: Number(event.target.value) })
                  }
                />
                <span className="preference-value">{draft.captionFontSize} px</span>
              </SettingRow>
              <div
                className="workspace-caption-preview"
                aria-label={t('工作台字幕预览')}
                style={
                  {
                    '--caption-font-size': `${draft.captionFontSize}px`,
                    '--caption-source-font-size': `${(draft.captionFontSize * 14) / 17}px`,
                  } as CSSProperties
                }
              >
                <p className="source-text">{t('这是原文预览')}</p>
                <p className="translation-text">{t('这是译文预览')}</p>
              </div>
              {(
                [
                  ['recognition', '语音识别'],
                  ['expression', '主动输入'],
                ] as const
              ).map(([kind, label]) => (
                <SettingRow title={label} key={kind}>
                  <CaptionColorPicker
                    label={t('{0}字幕颜色', t(label))}
                    customLabel={t('{0}自定义颜色', t(label))}
                    value={draft.captionColors[kind]}
                    onChange={(color) =>
                      setDraft({
                        ...draft,
                        captionColors: { ...draft.captionColors, [kind]: color },
                      })
                    }
                  />
                </SettingRow>
              ))}
            </div>
          </section>
          <section className="preference-section" aria-labelledby="listening-language-heading">
            <h2 id="listening-language-heading">{t('监听字幕')}</h2>
            <div className="preference-card">
              <SettingRow title={t('识别语言')}>
                <Select
                  label={t('语音识别语言')}
                  value={draft.listening.sourceLanguage}
                  options={[
                    '自动识别',
                    '简体中文',
                    '英语',
                    '日语',
                    '韩语',
                    '西班牙语',
                    '印尼语',
                    '粤语',
                    '芬兰语',
                    '俄语',
                    '德语',
                  ].map((language) => ({
                    value: language,
                    label: language,
                  }))}
                  onChange={(value) =>
                    setDraft({ ...draft, listening: { ...draft.listening, sourceLanguage: value } })
                  }
                />
              </SettingRow>
              <SettingRow title={t('字幕语言')}>
                <Select
                  label={t('字幕语言')}
                  value={draft.listening.targetLanguage}
                  options={[
                    '简体中文',
                    '英语',
                    '日语',
                    '韩语',
                    '西班牙语',
                    '印尼语',
                    '粤语',
                    '芬兰语',
                    '俄语',
                    '德语',
                  ].map((language) => ({
                    value: language,
                    label: language,
                  }))}
                  onChange={(value) =>
                    setDraft({ ...draft, listening: { ...draft.listening, targetLanguage: value } })
                  }
                />
              </SettingRow>
            </div>
          </section>
          <section className="preference-section" aria-labelledby="composer-heading">
            <h2 id="composer-heading">{t('文字表达')}</h2>
            <div className="preference-card">
              <SettingRow title={t('输入语言')}>
                <Select
                  label={t('文字输入语言')}
                  value={draft.sourceLanguage}
                  options={[
                    '简体中文',
                    '英语',
                    '日语',
                    '韩语',
                    '西班牙语',
                    '印尼语',
                    '粤语',
                    '芬兰语',
                    '俄语',
                    '德语',
                  ].map((language) => ({
                    value: language,
                    label: language,
                  }))}
                  onChange={(value) => setDraft({ ...draft, sourceLanguage: value })}
                />
              </SettingRow>
              <SettingRow title={t('输出语言')}>
                <Select
                  label={t('文字输出语言')}
                  value={draft.targetLanguage}
                  options={[
                    '简体中文',
                    '英语',
                    '日语',
                    '韩语',
                    '西班牙语',
                    '印尼语',
                    '粤语',
                    '芬兰语',
                    '俄语',
                    '德语',
                  ].map((language) => ({
                    value: language,
                    label: language,
                  }))}
                  onChange={(value) => setDraft({ ...draft, targetLanguage: value })}
                />
              </SettingRow>
              <SettingRow title={t('Enter 操作')}>
                <Select
                  label={t('Enter 操作')}
                  value={draft.composer.enterAction}
                  options={[
                    { value: 'speak', label: '输出语音' },
                    { value: 'translate', label: '仅翻译' },
                    { value: 'newline', label: '换行' },
                  ]}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      composer: {
                        ...draft.composer,
                        enterAction: value as Settings['composer']['enterAction'],
                      },
                    })
                  }
                />
              </SettingRow>
              <SettingRow title={t('语音内容')}>
                <Select
                  label={t('语音内容')}
                  value={draft.composer.output}
                  options={[
                    { value: 'translation', label: '译文 · 自动翻译后输出' },
                    { value: 'source', label: '原文 · 直接输出' },
                  ]}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      composer: {
                        ...draft.composer,
                        output: value as Settings['composer']['output'],
                      },
                    })
                  }
                />
              </SettingRow>
              <SettingRow title={t('默认语音输出')}>
                <Select
                  label={t('默认语音输出')}
                  value={draft.composer.route}
                  options={[
                    { value: 'send', label: '发送设备' },
                    { value: 'preview', label: '试听设备' },
                  ]}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      composer: {
                        ...draft.composer,
                        route: value as Settings['composer']['route'],
                      },
                    })
                  }
                />
              </SettingRow>
            </div>
          </section>
          <section className="preference-section" aria-labelledby="text-overlay-heading">
            <div className="preference-section-title">
              <h2 id="text-overlay-heading">{t('文本翻译悬浮窗')}</h2>
              <button
                className="subtle"
                onClick={() =>
                  setDraft({ ...draft, textOverlay: { ...textOverlayAppearanceDefaults } })
                }
              >
                {t('恢复默认')}
              </button>
            </div>
            <div className="preference-card">
              <SettingRow title={t('背景不透明度')}>
                <input
                  type="range"
                  aria-label={t('文本浮窗背景不透明度')}
                  min={20}
                  max={100}
                  step={1}
                  value={Math.round(draft.textOverlay.backgroundOpacity * 100)}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      textOverlay: {
                        ...draft.textOverlay,
                        backgroundOpacity: Number(event.target.value) / 100,
                      },
                    })
                  }
                />
                <span className="preference-value">
                  {Math.round(draft.textOverlay.backgroundOpacity * 100)}%
                </span>
              </SettingRow>
              <SettingRow title={t('字号')}>
                <input
                  type="range"
                  aria-label={t('文本浮窗字号')}
                  min={14}
                  max={40}
                  step={1}
                  value={draft.textOverlay.fontSize}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      textOverlay: { ...draft.textOverlay, fontSize: Number(event.target.value) },
                    })
                  }
                />
                <span className="preference-value">{draft.textOverlay.fontSize} px</span>
              </SettingRow>
              <SettingRow title={t('行距')}>
                <input
                  type="range"
                  aria-label={t('文本浮窗行距')}
                  min={1.2}
                  max={2.2}
                  step={0.05}
                  value={draft.textOverlay.lineHeight}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      textOverlay: { ...draft.textOverlay, lineHeight: Number(event.target.value) },
                    })
                  }
                />
                <span className="preference-value">{draft.textOverlay.lineHeight.toFixed(2)}</span>
              </SettingRow>
              <SettingRow title={t('文字颜色')}>
                <CaptionColorPicker
                  label={t('文本浮窗文字颜色')}
                  customLabel={t('文本浮窗自定义颜色')}
                  value={draft.textOverlay.textColor}
                  onChange={(textColor) =>
                    setDraft({ ...draft, textOverlay: { ...draft.textOverlay, textColor } })
                  }
                />
              </SettingRow>
            </div>
            <div
              className="text-overlay-appearance-preview"
              style={{
                background: `rgba(22,24,29,${draft.textOverlay.backgroundOpacity})`,
                color: draft.textOverlay.textColor,
                fontSize: draft.textOverlay.fontSize,
                lineHeight: draft.textOverlay.lineHeight,
              }}
            >
              {t('这是译文预览')}
            </div>
          </section>
          <section className="preference-section" aria-labelledby="subtitle-heading">
            <div className="preference-section-title">
              <h2 id="subtitle-heading">{t('悬浮字幕')}</h2>
              <button
                className="subtle"
                onClick={() => setDraft({ ...draft, subtitle: { ...subtitleDefaults } })}
              >
                {t('恢复默认')}
              </button>
            </div>
            <div className="preference-card">
              <SettingRow title={t('显示方式')}>
                <Select
                  label={t('悬浮字幕显示方式')}
                  value={draft.subtitle.mode}
                  options={[
                    { value: 'continuous', label: '连续阅读' },
                    { value: 'compact', label: '紧凑字幕' },
                  ]}
                  onChange={(mode) =>
                    setDraft({
                      ...draft,
                      subtitle: { ...draft.subtitle, mode: mode as Settings['subtitle']['mode'] },
                    })
                  }
                />
              </SettingRow>
              <SettingRow title={t('双语字幕')}>
                <BilingualToggle
                  checked={draft.subtitle.content === 'bilingual'}
                  label={t(draft.subtitle.content === 'bilingual' ? '开启' : '关闭')}
                  onChange={(bilingual) =>
                    setDraft((current) => ({
                      ...current,
                      subtitle: {
                        ...current.subtitle,
                        content: bilingual ? 'bilingual' : 'translation',
                      },
                    }))
                  }
                />
              </SettingRow>
              <SettingRow title={t('配色来源')}>
                <Select
                  label={t('悬浮字幕配色来源')}
                  value={draft.subtitle.colorMode}
                  options={[
                    { value: 'workspace', label: '跟随工作台字幕配色' },
                    { value: 'custom', label: '单独设置' },
                  ]}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      subtitle: { ...draft.subtitle, colorMode: value as 'workspace' | 'custom' },
                    })
                  }
                />
              </SettingRow>
              {draft.subtitle.colorMode === 'custom' && (
                <>
                  <SettingRow title={t('文字颜色')}>
                    <CaptionColorPicker
                      label={t('悬浮字幕文字颜色')}
                      customLabel={t('悬浮字幕自定义颜色')}
                      value={draft.subtitle.textColor}
                      onChange={(color) =>
                        setDraft({ ...draft, subtitle: { ...draft.subtitle, textColor: color } })
                      }
                    />
                  </SettingRow>
                </>
              )}
              <SettingRow title={t('行距')}>
                <input
                  type="range"
                  aria-label={t('悬浮字幕行距')}
                  min={1.2}
                  max={2.2}
                  step={0.05}
                  value={draft.subtitle.lineHeight}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      subtitle: { ...draft.subtitle, lineHeight: Number(event.target.value) },
                    })
                  }
                />
                <span className="preference-value">{draft.subtitle.lineHeight.toFixed(2)}</span>
              </SettingRow>
              <SettingRow title={t('字号')}>
                <input
                  type="range"
                  aria-label={t('悬浮字幕字号')}
                  min={14}
                  max={40}
                  step={1}
                  value={draft.subtitle.fontSize}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      subtitle: { ...draft.subtitle, fontSize: Number(event.target.value) },
                    })
                  }
                />
                <span className="preference-value">{draft.subtitle.fontSize} px</span>
              </SettingRow>
              <SettingRow title={t('背景不透明度')}>
                <input
                  type="range"
                  aria-label={t('悬浮字幕背景不透明度')}
                  min={20}
                  max={100}
                  step={1}
                  value={Math.round(draft.subtitle.backgroundOpacity * 100)}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      subtitle: {
                        ...draft.subtitle,
                        backgroundOpacity: Number(event.target.value) / 100,
                      },
                    })
                  }
                />
                <span className="preference-value">
                  {Math.round(draft.subtitle.backgroundOpacity * 100)}%
                </span>
              </SettingRow>
            </div>
          </section>
          <section className="preference-section" aria-labelledby="audio-heading">
            <div className="preference-section-title">
              <h2 id="audio-heading" tabIndex={-1}>
                {t('音频')}
              </h2>
              <button
                className="subtle"
                disabled={!desktop || refreshing}
                onClick={() => void refreshDevices()}
              >
                <RefreshCw size={14} />
                {t('刷新设备')}
              </button>
            </div>
            <div className="preference-card">
              <SettingRow title={t('监听应用')}>
                <button
                  className="subtle"
                  disabled={!desktop || !captureSupported || refreshingApplications}
                  onClick={() => void onRefreshApplications()}
                >
                  <RefreshCw size={14} />
                  {t(refreshingApplications ? '刷新中…' : '刷新应用')}
                </button>
              </SettingRow>
              <VirtualMicrophone
                devices={devices}
                selected={draft.audio.sendDeviceId}
                savedSelected={savedSettings.audio.sendDeviceId}
                onSelect={(id) =>
                  setDraft((current) => ({
                    ...current,
                    audio: { ...current.audio, sendDeviceId: id },
                  }))
                }
                onRefresh={refreshDevices}
                notify={notify}
              />
              <SettingRow title={t('发送时试听')}>
                <button
                  role="switch"
                  className="preference-toggle"
                  aria-label={t('发送时试听')}
                  aria-checked={draft.audio.monitorEnabled === true}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      audio: { ...draft.audio, monitorEnabled: !draft.audio.monitorEnabled },
                    })
                  }
                >
                  {t(draft.audio.monitorEnabled ? '开启' : '关闭')}
                </button>
              </SettingRow>
              <MicrophoneAccess notify={notify} />
              <SettingRow title={t('语音输入麦克风')}>
                <Select
                  label={t('语音输入麦克风')}
                  value={draft.audio.inputDeviceId || '__system_default__'}
                  disabled={!desktop || refreshing}
                  options={[
                    { value: '__system_default__', label: '系统默认麦克风' },
                    ...inputs.map((device) => ({
                      value: device.id,
                      label: device.name,
                      translate: false,
                    })),
                    ...(draft.audio.inputDeviceId &&
                    !inputs.some((device) => device.id === draft.audio.inputDeviceId)
                      ? [{ value: draft.audio.inputDeviceId, label: '已选麦克风（当前不可用）' }]
                      : []),
                  ]}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      audio: {
                        ...draft.audio,
                        inputDeviceId: value === '__system_default__' ? '' : value,
                      },
                    })
                  }
                />
              </SettingRow>
              <SettingRow title={t('试听设备')}>
                <Select
                  label={t('试听设备')}
                  value={draft.audio.previewDeviceId}
                  disabled={!desktop || refreshing}
                  placeholder={t('选择试听设备')}
                  options={previewDeviceOptions(devices, draft.audio.previewDeviceId)}
                  onChange={(value) =>
                    setDraft({ ...draft, audio: { ...draft.audio, previewDeviceId: value } })
                  }
                />
              </SettingRow>
              <SettingRow title={t('发送设备')}>
                <Select
                  label={t('发送设备')}
                  value={draft.audio.sendDeviceId}
                  disabled={!desktop || refreshing}
                  placeholder={t('系统默认')}
                  options={sendDeviceOptions(devices, draft.audio.sendDeviceId)}
                  onChange={(value) =>
                    setDraft({ ...draft, audio: { ...draft.audio, sendDeviceId: value } })
                  }
                />
              </SettingRow>
              <SettingRow title={t('音频设备与诊断')}>
                <button onClick={onDiagnostics}>
                  {t('打开')}
                  <ArrowUpRight size={14} />
                </button>
              </SettingRow>
              <div className="virtual-mic-help">
                <p>
                  {t(
                    '新用户默认自动选择虚拟麦克风发送，试听跟随系统默认；驱动未就绪时不会改发到扬声器。已有设备选择保持不变。',
                  )}
                </p>
              </div>
            </div>
          </section>
          <section className="preference-section" aria-labelledby="about-heading">
            <h2 id="about-heading">{t('关于')}</h2>
            <div className="preference-card">
              <SettingRow title="VoxBridge">
                <span className="preference-value">{version}</span>
              </SettingRow>
              <UpdateControls
                automatic={savedSettings.automaticUpdates}
                onAutomaticChange={onAutomaticUpdatesChange}
              />
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="preference-section" aria-labelledby="connection-heading">
            <div className="preference-section-title">
              <h2 id="connection-heading">{t('服务连接')}</h2>
              <Select
                label={t('新增服务配置')}
                compact
                value=""
                placeholder={t('新增配置')}
                disabled={draft.profiles.length >= 30 || busy}
                options={[
                  { value: 'custom', label: '空白配置' },
                  ...providerPresets
                    .filter((preset) => preset.stage === stage)
                    .map((preset) => ({
                      value: preset.id,
                      label: preset.name,
                      group: speechProvider(preset),
                    })),
                ]}
                onChange={(value) => {
                  if (value === 'custom') addProfile();
                  else {
                    try {
                      setDraft(applyProviderPreset(draft, value));
                    } catch (error) {
                      notify(String(error));
                    }
                  }
                }}
              />
            </div>
            <div className="preference-card">
              <SettingRow title={t('当前配置')}>
                <div className="profile-picker">
                  {renaming ? (
                    <>
                      <input
                        aria-label={t('配置名称')}
                        value={profile.name}
                        maxLength={80}
                        autoFocus
                        onChange={(e) => update({ name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && profile.name.trim()) {
                            e.preventDefault();
                            setRenaming(false);
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            update({ name: previousName });
                            setRenaming(false);
                          }
                        }}
                      />
                      <button
                        className="icon-button"
                        aria-label={t('完成重命名')}
                        disabled={!profile.name.trim()}
                        onClick={() => setRenaming(false)}
                      >
                        <Check size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <Select
                        label={t('当前配置')}
                        disabled={busy}
                        value={profile.id}
                        onChange={(value) =>
                          value === '__blank__'
                            ? addProfile()
                            : setDraft({ ...draft, active: { ...draft.active, [stage]: value } })
                        }
                        options={[
                          { value: '__blank__', label: '新建空白配置' },
                          ...draft.profiles
                            .filter((p) => p.stage === stage)
                            .map((p) => ({
                              value: p.id,
                              label: p.name,
                              translate: usesBuiltinProfileName(p),
                            })),
                        ]}
                      />
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label={t('重命名配置')}
                        aria-description={t('重命名配置')}
                        onClick={() => {
                          setPreviousName(profile.name);
                          setRenaming(true);
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label={t('删除当前配置')}
                        aria-description={t('删除当前配置')}
                        onClick={() => setDeletingProfile(profile.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </SettingRow>
              {deletingProfile === profile.id && (
                <div className="profile-delete-confirm" role="alert">
                  <p>{t('删除“{0}”及已保存的密钥？删除会立即保存，无法撤销。', profile.name)}</p>
                  <div>
                    <button disabled={busy} onClick={() => setDeletingProfile(null)}>
                      {t('取消')}
                    </button>
                    <button disabled={busy} onClick={() => void deleteCurrentProfile()}>
                      {t('确认删除')}
                    </button>
                  </div>
                </div>
              )}
              <SettingRow title={t('API 地址')}>
                <input
                  aria-label={t('API 地址')}
                  value={profile.baseUrl}
                  placeholder={
                    profile.adapter === 'minimax_tts_ws'
                      ? 'wss://api.minimax.cn/ws/v1/t2a_v2'
                      : 'https://api.example.com/v1'
                  }
                  onChange={(e) => update({ baseUrl: e.target.value })}
                  spellCheck={false}
                />
              </SettingRow>
              <SettingRow title={t('模型')}>
                <PresetSelect
                  key={`${profile.id}:${profile.adapter}:model`}
                  label={t('模型')}
                  value={profile.modelId}
                  options={modelOptions(profile)}
                  onChange={(modelId) => update(speechModelChange(profile, modelId))}
                />
              </SettingRow>
              <SettingRow title={t('接口类型')}>
                {stage === 'tts' ? (
                  <Select
                    label={t('语音合成协议')}
                    value={profile.adapter}
                    onChange={(value) =>
                      update({ adapter: value as ProviderProfile['adapter'], baseUrl: '' })
                    }
                    options={[
                      { value: 'minimax_tts_ws', label: 'MiniMax WebSocket' },
                      { value: 'openai_audio_speech', label: 'OpenAI 兼容语音' },
                    ]}
                  />
                ) : stage === 'asr' ? (
                  <Select
                    label={t('语音识别协议')}
                    value={profile.adapter}
                    onChange={(value) => update({ adapter: value as ProviderProfile['adapter'] })}
                    options={[
                      { value: 'pending_asr', label: '未配置协议' },
                      { value: 'openai_audio_transcriptions', label: 'OpenAI 兼容语音识别' },
                      { value: 'qwen_chat_asr', label: 'Qwen HTTP 短音频' },
                      { value: 'qwen_dashscope_asr', label: 'Qwen 实时识别' },
                    ]}
                  />
                ) : (
                  <span className="preference-value protocol-value">
                    {t(
                      profile.adapter === 'openai_chat_completions'
                        ? 'OpenAI 兼容'
                        : profile.adapter === 'minimax_tts_ws'
                          ? 'MiniMax WebSocket'
                          : '待选型',
                    )}
                  </span>
                )}
              </SettingRow>
              {stage === 'tts' && (
                <SettingRow title={t('语速')}>
                  <SpeechSpeed value={profile.speed} onChange={(speed) => update({ speed })} />
                </SettingRow>
              )}
              {stage === 'tts' && (
                <SettingRow title={t('音色')}>
                  <PresetSelect
                    key={`${profile.id}:${profile.adapter}:voice`}
                    label={t('音色')}
                    value={profile.voice}
                    options={voiceOptions(profile)}
                    onChange={(voice) => {
                      try {
                        update(selectSpeechVoice(profile, voice));
                      } catch (error) {
                        notify(t(error instanceof Error ? error.message : String(error)));
                      }
                    }}
                  />
                </SettingRow>
              )}
            </div>
          </section>
          <section
            className="preference-section service-extension-section"
            hidden={stage !== 'translation'}
          >
            {stage === 'translation' && (
              <details
                className="service-extensions preference-card"
                open={/^deepseek/i.test(profile.modelId) || undefined}
              >
                <summary>
                  <span>{t('服务扩展参数')}</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <p>{t('仅在服务明确支持时设置；不确定时保留服务默认。')}</p>
                <SettingRow title={t('思考模式')}>
                  <Select
                    label={t('翻译思考模式')}
                    value={profile.thinking ?? 'default'}
                    options={[
                      { value: 'default', label: '服务默认' },
                      { value: 'disabled', label: '关闭' },
                      { value: 'enabled', label: '开启' },
                    ]}
                    onChange={(value) =>
                      update({
                        thinking:
                          value === 'default' ? undefined : (value as 'enabled' | 'disabled'),
                      })
                    }
                  />
                </SettingRow>
              </details>
            )}
          </section>
          <ServiceCheck
            key={JSON.stringify([profile, hasKey !== false, Boolean(secret.trim())])}
            profile={profile}
            hasUnsavedKey={Boolean(secret.trim())}
            onDiagnostics={onDiagnostics}
          />
          {stage === 'tts' && <SpeechOptionsControls profile={profile} onChange={update} />}
          <PresetEditor
            key={`${profile.id}:${profile.adapter}:models`}
            profile={profile}
            kind="modelPresets"
            onChange={update}
          />
          {stage === 'tts' && (
            <PresetEditor
              key={`${profile.id}:${profile.adapter}:voices`}
              profile={profile}
              kind="voicePresets"
              onChange={update}
            />
          )}
          {stage === 'translation' && (
            <section className="preference-section" aria-labelledby="translation-prompt-heading">
              <div className="preference-section-title">
                <h2 id="translation-prompt-heading">{t('翻译风格')}</h2>
                <button
                  className="subtle"
                  onClick={() => update({ translationPrompt: defaultTranslationPrompt })}
                >
                  {t('恢复默认')}
                </button>
              </div>
              <div className="preference-card translation-prompt-editor">
                <textarea
                  aria-label={t('翻译前置 Prompt')}
                  value={profile.translationPrompt ?? defaultTranslationPrompt}
                  maxLength={translationPromptLimit}
                  rows={8}
                  spellCheck={false}
                  placeholder={defaultTranslationPrompt}
                  onChange={(event) => update({ translationPrompt: event.target.value })}
                />
                <p>{t('调整措辞和语气，目标语言由语言设置决定。留空使用默认提示词。')}</p>
              </div>
            </section>
          )}
          <section className="preference-section" aria-labelledby="credential-heading">
            <h2 id="credential-heading">{t('API 密钥')}</h2>
            <div className="preference-card">
              <SettingRow title="API Key">
                <span className={`credential-status ${hasKey ? 'positive' : ''}`}>
                  {hasKey && <Check size={13} />}
                  {t(hasKey === null ? '检查密钥…' : hasKey ? '已保存' : '未设置')}
                </span>
              </SettingRow>
              <div className="credential-editor">
                <div className="credential-input-row">
                  <input
                    aria-label={t('新的 API Key')}
                    type="password"
                    value={secret}
                    disabled={!desktop || busy}
                    autoComplete="off"
                    placeholder={t(desktop ? 'API Key' : '请在桌面应用中配置')}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                  <button
                    onClick={() => void saveKey()}
                    disabled={!desktop || (!secret.trim() && !hasKey) || busy}
                  >
                    {t(busy ? '处理中…' : '保存密钥')}
                  </button>
                  {hasKey && (
                    <button
                      className="icon-button"
                      aria-label={t('移除保存的密钥')}
                      aria-description={t('移除保存的密钥')}
                      onClick={() => void saveKey('clear')}
                      disabled={busy}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
                {keyError && (
                  <p role="alert" className="error-text">
                    {t(keyError)}
                  </p>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
