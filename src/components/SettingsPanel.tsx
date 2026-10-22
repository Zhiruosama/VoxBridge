import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { version } from '../../package.json';
import type { OutputDevice, ProviderProfile, Settings, Stage } from '../core/types';
import { profileFor } from '../core/settings';
import { credentialStatus, desktop, listOutputs, removeCredential, setCredential } from '../bridge';
import Select from './Select';
import SettingRow from './SettingRow';
import { applyProviderPreset, providerPresets } from '../core/provider-presets';

export type SettingsSection = 'general' | Stage;
const sectionTitles: Record<SettingsSection, string> = {
  general: '常规',
  translation: '文字翻译',
  asr: '语音识别',
  tts: '语音合成',
};

export default function SettingsPanel({
  settings,
  onSave,
  notify,
  onDiagnostics,
  section,
  onBusyChange,
}: {
  settings: Settings;
  onSave: (settings: Settings) => void;
  notify: (message: string) => void;
  onDiagnostics: () => void;
  section: SettingsSection;
  onBusyChange: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const stage: Stage = section === 'general' ? 'translation' : section;
  const profile = profileFor(draft, stage);
  const [secret, setSecret] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [previousName, setPreviousName] = useState('');
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  async function refreshDevices() {
    setRefreshing(true);
    try {
      setDevices(await listOutputs());
    } catch (error) {
      notify(String(error));
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    if (section !== 'general') return;
    let active = true;
    listOutputs()
      .then((next) => {
        if (active) setDevices(next);
      })
      .catch((error) => {
        if (active) notify(String(error));
      });
    return () => {
      active = false;
    };
  }, [section]);
  function deviceOptions(value: string) {
    const options = [
      ...new Map(
        devices.map((device) => [device.id, { value: device.id, label: device.name }]),
      ).values(),
    ];
    if (value && !devices.some((device) => device.id === value))
      options.push({ value, label: `${value}（不可用）` });
    return options;
  }
  useEffect(() => {
    setDraft(settings);
  }, [settings]);
  useEffect(() => {
    let active = true;
    setSecret('');
    setHasKey(false);
    setKeyError('');
    setRenaming(false);
    if (section === 'general') return;
    credentialStatus(profile.id)
      .then((exists) => {
        if (active) setHasKey(exists);
      })
      .catch((error) => {
        if (active) setKeyError(String(error));
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
  async function saveKey(remove = false) {
    setBusy(true);
    setKeyError('');
    try {
      if (remove) await removeCredential(profile.id);
      else await setCredential(profile.id, secret);
      setSecret('');
      setHasKey(!remove);
      notify(remove ? '此配置的密钥已删除。' : '密钥已保存到系统凭据存储。');
    } catch (error) {
      setKeyError(String(error));
    } finally {
      setBusy(false);
    }
  }
  function addProfile() {
    const id = crypto.randomUUID();
    const next = {
      ...profile,
      id,
      name: `${sectionTitles[stage]} ${draft.profiles.filter((p) => p.stage === stage).length + 1}`,
      baseUrl: '',
      modelId: '',
      voice: '',
    };
    setDraft({
      ...draft,
      profiles: [...draft.profiles, next],
      active: { ...draft.active, [stage]: id },
    });
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  return (
    <div className="settings-page preferences-page">
      <header className="preferences-heading">
        <div className="preferences-title">
          <h1>{sectionTitles[section]}</h1>
          {section === 'asr' && <span className="tag">接入中</span>}
        </div>
        <div className="preferences-save">
          {dirty && <span role="status">未保存</span>}
          <button
            disabled={busy || !dirty || (renaming && !profile.name.trim())}
            onClick={() => onSave(draft)}
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
              <SettingRow title="试听设备">
                <Select
                  label="试听设备"
                  value={draft.audio.previewDeviceId}
                  disabled={!desktop || refreshing}
                  placeholder="选择试听设备"
                  options={deviceOptions(draft.audio.previewDeviceId)}
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
              {stage === 'asr' ? (
                <button
                  className="subtle"
                  onClick={addProfile}
                  disabled={draft.profiles.length >= 30 || busy}
                >
                  <Plus size={14} />
                  新增配置
                </button>
              ) : (
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
                      .map((preset) => ({ value: preset.id, label: preset.name })),
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
              )}
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
                          setDraft({ ...draft, active: { ...draft.active, [stage]: value } })
                        }
                        options={draft.profiles
                          .filter((p) => p.stage === stage)
                          .map((p) => ({ value: p.id, label: p.name }))}
                      />
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label="重命名配置"
                        title="重命名配置"
                        onClick={() => {
                          setPreviousName(profile.name);
                          setRenaming(true);
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                    </>
                  )}
                </div>
              </SettingRow>
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
              <SettingRow title="模型 ID">
                <input
                  aria-label="模型 ID"
                  value={profile.modelId}
                  placeholder="model-id"
                  spellCheck={false}
                  onChange={(e) => update({ modelId: e.target.value })}
                />
              </SettingRow>
              <SettingRow title="接口协议">
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
                <SettingRow title="音色 ID">
                  <input
                    aria-label="音色 ID"
                    value={profile.voice}
                    onChange={(e) => update({ voice: e.target.value })}
                    placeholder="voice-id"
                  />
                </SettingRow>
              )}
            </div>
          </section>
          <section className="preference-section" aria-labelledby="credential-heading">
            <h2 id="credential-heading">访问凭据</h2>
            <div className="preference-card">
              <SettingRow title="API Key">
                <span className={`credential-status ${hasKey ? 'positive' : ''}`}>
                  {hasKey && <Check size={13} />}
                  {hasKey ? '已配置' : '未配置'}
                </span>
              </SettingRow>
              <div className="credential-editor">
                <div className="credential-input-row">
                  <input
                    aria-label="新的 API Key"
                    type="password"
                    value={secret}
                    disabled={!desktop || busy}
                    autoComplete="new-password"
                    placeholder={desktop ? 'API Key' : '请在桌面应用中配置'}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                  <button
                    onClick={() => void saveKey()}
                    disabled={!desktop || !secret.trim() || busy}
                  >
                    {busy ? '处理中…' : '保存密钥'}
                  </button>
                  {hasKey && (
                    <button
                      className="icon-button"
                      aria-label="删除当前配置密钥"
                      title="删除当前配置密钥"
                      onClick={() => void saveKey(true)}
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
