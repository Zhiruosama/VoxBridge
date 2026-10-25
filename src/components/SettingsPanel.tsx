import SpeechSpeed from './SpeechSpeed';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { ArrowUpRight, Check, Pencil, RefreshCw, Save, Trash2 } from 'lucide-react';
import { version } from '../../package.json';
import type { OutputDevice, ProviderProfile, Settings, Stage } from '../core/types';
import { defaultTranslationPrompt, translationPromptLimit } from '../core/translation-prompt';
import { blankProfile, profileFor, captionColorDefaults } from '../core/settings';
import {
  outputDeviceOptions,
  previewDeviceOptions,
  voxBridgeOutputId,
} from '../core/audio-routing';
import {
  openVirtualMicInstaller,
  credentialStatus,
  desktop,
  listOutputs,
  listInputs,
  removeCredential,
  setCredential,
} from '../bridge';
import { subtitleColors, subtitleDefaults } from '../core/overlay';
import Select from './Select';
import SettingRow from './SettingRow';
import PresetEditor from './PresetEditor';
import PresetSelect from './PresetSelect';
import {
  applyProviderPreset,
  providerPresets,
  removeProviderProfile,
} from '../core/provider-presets';
import {
  modelOptions,
  voiceOptions,
  speechProvider,
  speechModelChange,
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
  onSave,
  notify,
  onDiagnostics,
  onRefreshApplications,
  refreshingApplications,
  captureSupported,
  section,
  onBusyChange,
}: {
  settings: Settings;
  savedSettings: Settings;
  onDraftChange: Dispatch<SetStateAction<Settings>>;
  onSave: (settings: Settings) => void;
  notify: (message: string) => void;
  onDiagnostics: () => void;
  onRefreshApplications: () => Promise<void>;
  refreshingApplications: boolean;
  captureSupported: boolean;
  section: SettingsSection;
  onBusyChange: (busy: boolean) => void;
}) {
  const draft = settings;
  const setDraft = onDraftChange;
  const stage: Stage = section === 'general' ? 'translation' : section;
  const profile = profileFor(draft, stage);
  const [secret, setSecret] = useState('');
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState<string | null>(null);
  const [previousName, setPreviousName] = useState('');
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const [inputs, setInputs] = useState<OutputDevice[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  async function refreshDevices() {
    setRefreshing(true);
    try {
      const [outputs, microphones] = await Promise.all([listOutputs(), listInputs()]);
      setDevices(outputs);
      setInputs(microphones);
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
        }
      })
      .catch((error) => {
        if (active) notify(String(error));
      });
    return () => {
      active = false;
    };
  }, [section]);
  function deviceOptions(value: string) {
    return outputDeviceOptions(devices, value);
  }
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
          <h1>{sectionTitles[section]}</h1>
        </div>
        <div className="preferences-save">
          {dirty && <span role="status">未保存</span>}
          <button
            disabled={busy || !dirty || (renaming && !profile.name.trim())}
            onClick={() => void saveCurrent()}
          >
            <Save size={14} />
            保存更改
          </button>
        </div>
      </header>
      {section === 'general' ? (
        <>
          <section className="preference-section" aria-labelledby="appearance-heading">
            <h2 id="appearance-heading">外观</h2>
            <div className="preference-card">
              <SettingRow title="主题">
                <Select
                  label="主题"
                  value={draft.theme}
                  onChange={(value) => setDraft({ ...draft, theme: value as Settings['theme'] })}
                  options={[
                    { value: 'dark', label: '深色' },
                    { value: 'light', label: '浅色' },
                    { value: 'system', label: '跟随系统' },
                  ]}
                />
              </SettingRow>
            </div>
          </section>
          <section className="preference-section" aria-labelledby="caption-colors-heading">
            <div className="preference-section-title">
              <h2 id="caption-colors-heading">工作台字幕配色</h2>
              <button
                onClick={() => setDraft({ ...draft, captionColors: { ...captionColorDefaults } })}
              >
                恢复默认
              </button>
            </div>
            <div className="preference-card">
              {(
                [
                  ['recognition', '语音识别'],
                  ['expression', '主动输入'],
                ] as const
              ).map(([kind, label]) => (
                <SettingRow title={label} key={kind}>
                  <div
                    className="subtitle-color-options"
                    role="group"
                    aria-label={`${label}字幕颜色`}
                  >
                    {subtitleColors.map((color, index) => (
                      <button
                        key={color}
                        className="subtitle-color"
                        aria-label={['白色', '黄色', '绿色', '青色', '橙色', '粉色'][index]}
                        aria-pressed={draft.captionColors[kind] === color}
                        style={{ backgroundColor: color }}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            captionColors: { ...draft.captionColors, [kind]: color },
                          })
                        }
                      />
                    ))}
                    <input
                      type="color"
                      className="caption-custom-color"
                      aria-label={`${label}自定义颜色`}
                      value={draft.captionColors[kind]}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          captionColors: { ...draft.captionColors, [kind]: event.target.value },
                        })
                      }
                    />
                  </div>
                </SettingRow>
              ))}
            </div>
          </section>
          <section className="preference-section" aria-labelledby="listening-language-heading">
            <h2 id="listening-language-heading">监听字幕</h2>
            <div className="preference-card">
              <SettingRow title="识别语言">
                <Select
                  label="语音识别语言"
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
              <SettingRow title="字幕语言">
                <Select
                  label="字幕语言"
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
            <h2 id="composer-heading">文字表达</h2>
            <div className="preference-card">
              <SettingRow title="输入语言">
                <Select
                  label="文字输入语言"
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
              <SettingRow title="输出语言">
                <Select
                  label="文字输出语言"
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
              <SettingRow title="Enter 操作">
                <Select
                  label="Enter 操作"
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
              <SettingRow title="语音内容">
                <Select
                  label="语音内容"
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
              <SettingRow title="默认语音输出">
                <Select
                  label="默认语音输出"
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
            <p className="preference-help">
              Shift + Enter 换行。翻译和语音合成会调用所选服务，可能计费。
            </p>
          </section>
          <section className="preference-section" aria-labelledby="subtitle-heading">
            <div className="preference-section-title">
              <h2 id="subtitle-heading">悬浮字幕</h2>
              <button
                className="subtle"
                onClick={() => setDraft({ ...draft, subtitle: { ...subtitleDefaults } })}
              >
                恢复默认
              </button>
            </div>
            <div className="preference-card">
              <SettingRow title="显示方式">
                <Select
                  label="悬浮字幕显示方式"
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
              <SettingRow title="显示内容">
                <Select
                  label="悬浮字幕显示内容"
                  value={draft.subtitle.content}
                  options={[
                    { value: 'translation', label: '译文优先' },
                    { value: 'bilingual', label: '双语' },
                    { value: 'source', label: '原文' },
                  ]}
                  onChange={(content) =>
                    setDraft({
                      ...draft,
                      subtitle: {
                        ...draft.subtitle,
                        content: content as Settings['subtitle']['content'],
                      },
                    })
                  }
                />
              </SettingRow>
              <SettingRow title="配色来源">
                <Select
                  label="悬浮字幕配色来源"
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
                  <SettingRow title="文字颜色">
                    <div
                      className="subtitle-color-options"
                      role="group"
                      aria-label="悬浮字幕文字颜色"
                    >
                      {subtitleColors.map((color, index) => (
                        <button
                          key={color}
                          className="subtitle-color"
                          aria-label={['白色', '黄色', '绿色', '青色', '橙色', '粉色'][index]}
                          aria-pressed={draft.subtitle.textColor === color}
                          style={{ backgroundColor: color }}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              subtitle: { ...draft.subtitle, textColor: color },
                            })
                          }
                        />
                      ))}
                      <input
                        type="color"
                        aria-label="悬浮字幕自定义颜色"
                        className="caption-custom-color"
                        value={draft.subtitle.textColor}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            subtitle: { ...draft.subtitle, textColor: event.target.value },
                          })
                        }
                      />
                    </div>
                  </SettingRow>
                </>
              )}
              <SettingRow title="行距">
                <input
                  type="range"
                  aria-label="悬浮字幕行距"
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
              <SettingRow title="字号">
                <input
                  type="range"
                  aria-label="悬浮字幕字号"
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
              <SettingRow title="背景不透明度">
                <input
                  type="range"
                  aria-label="悬浮字幕背景不透明度"
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
              <h2 id="audio-heading">音频</h2>
              <button
                className="subtle"
                disabled={!desktop || refreshing}
                onClick={() => void refreshDevices()}
              >
                <RefreshCw size={14} />
                刷新设备
              </button>
            </div>
            <div className="preference-card">
              <SettingRow title="监听应用">
                <button
                  className="subtle"
                  disabled={!desktop || !captureSupported || refreshingApplications}
                  onClick={() => void onRefreshApplications()}
                >
                  <RefreshCw size={14} />
                  {refreshingApplications ? '刷新中…' : '刷新应用'}
                </button>
              </SettingRow>
              <SettingRow title="虚拟麦克风">
                <span className="preference-value">
                  {devices.some((d) => d.id === voxBridgeOutputId)
                    ? 'VoxBridge 已就绪'
                    : '尚未安装'}
                </span>
                {devices.some((d) => d.id === voxBridgeOutputId) ? (
                  <button
                    className="subtle"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        audio: {
                          ...draft.audio,
                          sendDeviceId: voxBridgeOutputId,
                        },
                      })
                    }
                  >
                    用作发送设备
                  </button>
                ) : (
                  <button
                    className="subtle"
                    disabled={!desktop}
                    onClick={() =>
                      void openVirtualMicInstaller().catch((error) => notify(String(error)))
                    }
                  >
                    安装虚拟麦克风
                  </button>
                )}
              </SettingRow>
              <SettingRow title="发送时试听">
                <button
                  role="switch"
                  className="preference-toggle"
                  aria-label="发送时试听"
                  aria-checked={draft.audio.monitorEnabled === true}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      audio: { ...draft.audio, monitorEnabled: !draft.audio.monitorEnabled },
                    })
                  }
                >
                  {draft.audio.monitorEnabled ? '开启' : '关闭'}
                </button>
              </SettingRow>
              <SettingRow title="语音输入麦克风">
                <Select
                  label="语音输入麦克风"
                  value={draft.audio.inputDeviceId || '__system_default__'}
                  disabled={!desktop || refreshing}
                  options={[
                    { value: '__system_default__', label: '系统默认麦克风' },
                    ...inputs.map((device) => ({ value: device.id, label: device.name })),
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
              <SettingRow title="试听设备">
                <Select
                  label="试听设备"
                  value={draft.audio.previewDeviceId}
                  disabled={!desktop || refreshing}
                  placeholder="选择试听设备"
                  options={previewDeviceOptions(devices, draft.audio.previewDeviceId)}
                  onChange={(value) =>
                    setDraft({ ...draft, audio: { ...draft.audio, previewDeviceId: value } })
                  }
                />
              </SettingRow>
              <SettingRow title="发送设备">
                <Select
                  label="发送设备"
                  value={draft.audio.sendDeviceId}
                  disabled={!desktop || refreshing}
                  placeholder="选择虚拟音频设备"
                  options={deviceOptions(draft.audio.sendDeviceId)}
                  onChange={(value) =>
                    setDraft({ ...draft, audio: { ...draft.audio, sendDeviceId: value } })
                  }
                />
              </SettingRow>
              <SettingRow title="音频设备与诊断">
                <button onClick={onDiagnostics}>
                  打开
                  <ArrowUpRight size={14} />
                </button>
              </SettingRow>
            </div>
          </section>
          <section className="preference-section" aria-labelledby="about-heading">
            <h2 id="about-heading">关于</h2>
            <div className="preference-card">
              <SettingRow title="VoxBridge">
                <span className="preference-value">{version}</span>
              </SettingRow>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="preference-section" aria-labelledby="connection-heading">
            <div className="preference-section-title">
              <h2 id="connection-heading">服务连接</h2>
              <Select
                label="新增服务配置"
                compact
                value=""
                placeholder="新增配置"
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
              <SettingRow title="当前配置">
                <div className="profile-picker">
                  {renaming ? (
                    <>
                      <input
                        aria-label="配置名称"
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
                        aria-label="完成重命名"
                        disabled={!profile.name.trim()}
                        onClick={() => setRenaming(false)}
                      >
                        <Check size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <Select
                        label="当前配置"
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
                            .map((p) => ({ value: p.id, label: p.name })),
                        ]}
                      />
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label="重命名配置"
                        aria-description="重命名配置"
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
                        aria-label="删除当前配置"
                        aria-description="删除当前配置"
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
                  <p>删除“{profile.name}”及已保存的密钥？删除会立即保存，无法撤销。</p>
                  <div>
                    <button disabled={busy} onClick={() => setDeletingProfile(null)}>
                      取消
                    </button>
                    <button disabled={busy} onClick={() => void deleteCurrentProfile()}>
                      确认删除
                    </button>
                  </div>
                </div>
              )}
              <SettingRow title="API 地址">
                <input
                  aria-label="API 地址"
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
              <SettingRow title="模型">
                <PresetSelect
                  key={`${profile.id}:${profile.adapter}:model`}
                  label="模型"
                  value={profile.modelId}
                  options={modelOptions(profile)}
                  onChange={(modelId) => update(speechModelChange(profile, modelId))}
                />
              </SettingRow>
              <SettingRow title="接口类型">
                {stage === 'tts' ? (
                  <Select
                    label="语音合成协议"
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
                    label="语音识别协议"
                    value={profile.adapter}
                    onChange={(value) => update({ adapter: value as ProviderProfile['adapter'] })}
                    options={[
                      { value: 'pending_asr', label: '未配置协议' },
                      { value: 'qwen_chat_asr', label: 'Qwen HTTP 短音频' },
                      { value: 'qwen_dashscope_asr', label: 'Qwen 实时识别' },
                    ]}
                  />
                ) : (
                  <span className="preference-value protocol-value">
                    {profile.adapter === 'openai_chat_completions'
                      ? 'OpenAI 兼容'
                      : profile.adapter === 'minimax_tts_ws'
                        ? 'MiniMax WebSocket'
                        : '待选型'}
                  </span>
                )}
              </SettingRow>
              {stage === 'translation' && (
                <SettingRow title="思考模式">
                  <Select
                    label="翻译思考模式"
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
              )}
              {stage === 'tts' && (
                <SettingRow title="语速">
                  <SpeechSpeed value={profile.speed} onChange={(speed) => update({ speed })} />
                </SettingRow>
              )}
              {stage === 'tts' && (
                <SettingRow title="音色">
                  <PresetSelect
                    key={`${profile.id}:${profile.adapter}:voice`}
                    label="音色"
                    value={profile.voice}
                    options={voiceOptions(profile)}
                    onChange={(voice) => update({ voice })}
                  />
                </SettingRow>
              )}
            </div>
          </section>
          <section className="preference-section" aria-labelledby="personal-presets-heading">
            <h2 id="personal-presets-heading">自定义预设</h2>
            <div className="preference-card">
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
            </div>
          </section>
          {stage === 'translation' && (
            <section className="preference-section" aria-labelledby="translation-prompt-heading">
              <div className="preference-section-title">
                <h2 id="translation-prompt-heading">翻译风格</h2>
                <button
                  className="subtle"
                  onClick={() => update({ translationPrompt: defaultTranslationPrompt })}
                >
                  恢复默认
                </button>
              </div>
              <div className="preference-card translation-prompt-editor">
                <textarea
                  aria-label="翻译前置 Prompt"
                  value={profile.translationPrompt ?? defaultTranslationPrompt}
                  maxLength={translationPromptLimit}
                  rows={8}
                  spellCheck={false}
                  placeholder={defaultTranslationPrompt}
                  onChange={(event) => update({ translationPrompt: event.target.value })}
                />
                <p>调整措辞和语气，目标语言由语言设置决定。留空使用默认提示词。</p>
              </div>
            </section>
          )}
          <section className="preference-section" aria-labelledby="credential-heading">
            <h2 id="credential-heading">API 密钥</h2>
            <div className="preference-card">
              <SettingRow title="API Key">
                <span className={`credential-status ${hasKey ? 'positive' : ''}`}>
                  {hasKey && <Check size={13} />}
                  {hasKey === null ? '检查密钥…' : hasKey ? '已保存' : '未设置'}
                </span>
              </SettingRow>
              <div className="credential-editor">
                <div className="credential-input-row">
                  <input
                    aria-label="新的 API Key"
                    type="password"
                    value={secret}
                    disabled={!desktop || busy}
                    autoComplete="off"
                    placeholder={desktop ? 'API Key' : '请在桌面应用中配置'}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                  <button
                    onClick={() => void saveKey()}
                    disabled={!desktop || (!secret.trim() && !hasKey) || busy}
                  >
                    {busy ? '处理中…' : '保存密钥'}
                  </button>
                  {hasKey && (
                    <button
                      className="icon-button"
                      aria-label="移除保存的密钥"
                      aria-description="移除保存的密钥"
                      onClick={() => void saveKey('clear')}
                      disabled={busy}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
                {keyError && (
                  <p role="alert" className="error-text">
                    {keyError}
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
