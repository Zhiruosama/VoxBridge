import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, Check, Plus, Save, Trash2 } from 'lucide-react';
import { version } from '../../package.json';
import type { ProviderProfile, Settings, Stage } from '../core/types';
import { profileFor } from '../core/settings';
import { credentialStatus, desktop, removeCredential, setCredential } from '../bridge';
import Select from './Select';

export type SettingsSection = 'general' | Stage;
const sectionTitles: Record<SettingsSection, string> = {
  general: '常规',
  translation: '文字翻译',
  asr: '语音识别',
  tts: '语音合成',
};
function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="preference-row">
      <div className="preference-copy">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      <div className="preference-control">{children}</div>
    </div>
  );
}

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
  useEffect(() => {
    setDraft(settings);
  }, [settings]);
  useEffect(() => {
    let active = true;
    setSecret('');
    setHasKey(false);
    setKeyError('');
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
    const next = { ...profile, id, name: '新服务配置', baseUrl: '', modelId: '', voice: '' };
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
        <h1>{sectionTitles[section]}</h1>
        <div className="preferences-save">
          {dirty && <span role="status">未保存</span>}
          <button disabled={busy || !dirty} onClick={() => onSave(draft)}>
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
              <SettingRow title="主题" description="选择应用的颜色主题。">
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
            <h2 id="audio-heading">音频</h2>
            <div className="preference-card">
              <SettingRow title="音频设备与诊断" description="检查输出设备、测试声音与字幕演示。">
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
              <SettingRow title="VoxBridge" description="桌面语音翻译工具。">
                <span className="preference-value">{version}</span>
              </SettingRow>
            </div>
          </section>
        </>
      ) : (
        <>
          {stage !== 'translation' && (
            <p className="integration-note">
              {stage === 'asr' ? '语音识别服务' : '语音合成服务'}接入中，当前可保存配置。
            </p>
          )}
          <section className="preference-section" aria-labelledby="connection-heading">
            <div className="preference-section-title">
              <h2 id="connection-heading">服务连接</h2>
              <button
                className="subtle"
                onClick={addProfile}
                disabled={draft.profiles.length >= 30 || busy}
              >
                <Plus size={14} />
                新增配置
              </button>
            </div>
            <div className="preference-card">
              <SettingRow title="当前配置" description="此阶段使用的服务配置。">
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
              </SettingRow>
              <SettingRow title="配置名称">
                <input
                  aria-label="配置名称"
                  value={profile.name}
                  maxLength={80}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </SettingRow>
              <SettingRow
                title="API 地址"
                description={
                  stage === 'translation'
                    ? '填写服务根地址，可包含 /v1。'
                    : '填写服务提供的语音接口地址。'
                }
              >
                <input
                  aria-label="API 地址"
                  value={profile.baseUrl}
                  placeholder={stage === 'tts' ? 'wss://服务地址/语音端点' : 'https://服务地址/v1'}
                  onChange={(e) => update({ baseUrl: e.target.value })}
                  spellCheck={false}
                />
              </SettingRow>
              <SettingRow title="模型 ID" description="填写服务支持的模型名称。">
                <input
                  aria-label="模型 ID"
                  value={profile.modelId}
                  placeholder="模型名称"
                  spellCheck={false}
                  onChange={(e) => update({ modelId: e.target.value })}
                />
              </SettingRow>
              <SettingRow title="接口协议">
                <span className="preference-value protocol-value">
                  {profile.adapter === 'openai_chat_completions'
                    ? 'OpenAI 兼容'
                    : profile.adapter === 'minimax_tts_ws'
                      ? 'MiniMax WebSocket'
                      : '待选型'}
                </span>
              </SettingRow>
              {stage === 'tts' && (
                <SettingRow title="音色 ID">
                  <input
                    aria-label="音色 ID"
                    value={profile.voice}
                    onChange={(e) => update({ voice: e.target.value })}
                    placeholder="音色名称"
                  />
                </SettingRow>
              )}
            </div>
          </section>
          <section className="preference-section" aria-labelledby="credential-heading">
            <h2 id="credential-heading">访问凭据</h2>
            <div className="preference-card">
              <SettingRow title="API Key" description="保存在本机，已有密钥不会回显。">
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
                    placeholder={desktop ? '输入密钥以新增或替换' : '请在桌面应用中配置密钥'}
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
            <p className="preference-hint">密钥单独保存；服务与模型的修改需点击“保存更改”。</p>
          </section>
        </>
      )}
    </div>
  );
}
