import { useEffect, useState } from 'react';
import { Check, KeyRound, Plus, Save, Trash2 } from 'lucide-react';
import type { ProviderProfile, Settings, Stage } from '../core/types';
import { profileFor } from '../core/settings';
import { credentialStatus, desktop, removeCredential, setCredential } from '../bridge';

const stages: { id: Stage; name: string }[] = [
  { id: 'translation', name: '文字翻译' },
  { id: 'asr', name: '语音识别' },
  { id: 'tts', name: '语音合成' },
];
export default function SettingsPanel({
  settings,
  onSave,
  notify,
  onDiagnostics,
}: {
  settings: Settings;
  onSave: (settings: Settings) => void;
  notify: (message: string) => void;
  onDiagnostics: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [stage, setStage] = useState<Stage>('translation');
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
  }, [profile.id]);

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

  return (
    <div className="settings-page content-page">
      <div className="page-heading">
        <div>
          <h1>设置</h1>
        </div>
        <button className="primary" disabled={busy} onClick={() => onSave(draft)}>
          <Save size={15} />
          保存设置
        </button>
      </div>
      <div className="settings-tabs" role="tablist" aria-label="服务阶段">
        {stages.map((s) => (
          <button
            role="tab"
            disabled={busy}
            aria-selected={stage === s.id}
            key={s.id}
            onClick={() => setStage(s.id)}
          >
            {s.name}
          </button>
        ))}
      </div>
      <section className="settings-section">
        <div className="section-heading">
          <div>
            <h2>服务连接</h2>
            <p>
              {stage === 'translation'
                ? '支持 OpenAI-compatible Chat Completions；请求由本机后端发出。'
                : '先保存配置；此语音协议的实际调用仍在接入。'}
            </p>
          </div>
          <button
            className="subtle"
            onClick={addProfile}
            disabled={draft.profiles.length >= 30 || busy}
          >
            <Plus size={14} />
            新增配置
          </button>
        </div>
        <div className="form-grid">
          <label>
            当前配置
            <select
              disabled={busy}
              value={profile.id}
              onChange={(e) =>
                setDraft({ ...draft, active: { ...draft.active, [stage]: e.target.value } })
              }
            >
              {draft.profiles
                .filter((p) => p.stage === stage)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            配置名称
            <input
              value={profile.name}
              maxLength={80}
              onChange={(e) => update({ name: e.target.value })}
            />
          </label>
          <label className="wide">
            API 地址
            <input
              value={profile.baseUrl}
              placeholder={stage === 'tts' ? 'wss://服务地址/语音端点' : 'https://服务地址/v1'}
              onChange={(e) => update({ baseUrl: e.target.value })}
              spellCheck={false}
            />
            <small>
              {stage === 'translation'
                ? '填写根地址（可含 /v1），不含 /chat/completions。'
                : '填写此适配器要求的地址；文本接口兼容不代表语音接口兼容。'}
            </small>
          </label>
          <label>
            模型 ID
            <input
              value={profile.modelId}
              placeholder="手动填写模型名称"
              spellCheck={false}
              onChange={(e) => update({ modelId: e.target.value })}
            />
          </label>
          <label>
            协议
            <input
              value={
                profile.adapter === 'openai_chat_completions'
                  ? 'OpenAI-compatible · Chat Completions'
                  : profile.adapter === 'minimax_tts_ws'
                    ? 'MiniMax · WebSocket（接入中）'
                    : '流式 ASR（待选型）'
              }
              readOnly
            />
          </label>
          {stage === 'tts' && (
            <label className="wide">
              音色 ID
              <input
                value={profile.voice}
                onChange={(e) => update({ voice: e.target.value })}
                placeholder="服务支持的音色 ID"
              />
            </label>
          )}
        </div>
      </section>
      <section className="settings-section">
        <div className="section-heading">
          <div>
            <h2>
              <KeyRound size={15} /> API Key
            </h2>
            <p>密钥单独保存，不写入普通设置，也不回显已有值。</p>
          </div>
          <span className={`tag ${hasKey ? 'positive' : ''}`}>
            {hasKey ? (
              <>
                <Check size={12} />
                已配置
              </>
            ) : (
              '未配置'
            )}
          </span>
        </div>
        <div className="key-row">
          <label className="grow">
            <span className="sr-only">新的 API Key</span>
            <input
              type="password"
              value={secret}
              disabled={!desktop || busy}
              autoComplete="new-password"
              placeholder={desktop ? '输入密钥以新增或替换' : '请使用桌面版配置密钥'}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
          <button onClick={() => void saveKey()} disabled={!desktop || !secret.trim() || busy}>
            保存密钥
          </button>
          <button
            aria-label="删除当前配置密钥"
            title="删除当前配置密钥"
            onClick={() => void saveKey(true)}
            disabled={!hasKey || busy}
          >
            <Trash2 size={15} />
          </button>
        </div>
        {keyError && (
          <p role="alert" className="error-text">
            {keyError}
          </p>
        )}
        <small>
          macOS 使用 Keychain；Windows 开发版使用系统凭据存储。更换服务地址时，请核对密钥所属服务。
        </small>
      </section>
      <section className="settings-section">
        <div className="section-heading">
          <div>
            <h2>外观</h2>
          </div>
        </div>
        <label className="theme-select">
          主题
          <select
            value={draft.theme}
            onChange={(e) => setDraft({ ...draft, theme: e.target.value as Settings['theme'] })}
          >
            <option value="dark">深色</option>
            <option value="light">浅色</option>
            <option value="system">跟随系统</option>
          </select>
        </label>
      </section>
      <p className="footnote">
        {JSON.stringify(draft) !== JSON.stringify(settings)
          ? '有修改尚未保存；离开设置页将放弃这些修改。'
          : '设置已保存。'}{' '}
        下次任务使用新配置。ASR / TTS 配置保存成功不代表语音功能已通过验证。
      </p>
      <button className="diagnostics-link subtle" onClick={onDiagnostics}>
        音频设备与诊断
      </button>
    </div>
  );
}
