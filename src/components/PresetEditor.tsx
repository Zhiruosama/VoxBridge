import { t } from '../i18n';
import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { ProviderProfile } from '../core/types';
import { editProfilePreset, profilePresetLimit, type PresetKind } from '../core/profile-presets';

export default function PresetEditor({
  profile,
  kind,
  onChange,
}: {
  profile: ProviderProfile;
  kind: PresetKind;
  onChange: (profile: ProviderProfile) => void;
}) {
  const title = kind === 'modelPresets' ? '模型' : '音色';
  const entries = profile[kind] ?? [];
  const [editing, setEditing] = useState<{
    index: number | null;
    name: string;
    value: string;
  } | null>(null);
  const [error, setError] = useState('');
  const begin = (index: number | null) => {
    setError('');
    const item = index === null ? null : entries[index];
    setEditing({
      index,
      name: item?.name ?? '',
      value: item?.value ?? (kind === 'modelPresets' ? profile.modelId : profile.voice),
    });
  };
  const complete = () => {
    if (!editing) return;
    try {
      onChange(
        editProfilePreset(profile, kind, editing.index, {
          name: editing.name,
          value: editing.value,
          adapter: profile.adapter,
        }),
      );
      setEditing(null);
      setError('');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };
  return (
    <section className="preset-editor" aria-label={t('我的{0}预设', t(title))}>
      <div className="preset-editor-heading">
        <h3>{t('我的{0}预设', t(title))}</h3>
        <button
          className="subtle"
          disabled={
            Boolean(editing) ||
            entries.length >= profilePresetLimit ||
            profile.adapter === 'pending_asr'
          }
          onClick={() => begin(null)}
        >
          <Plus size={13} />
          {t('添加{0}', t(title))}
        </button>
      </div>
      {entries.filter((item) => item.adapter === profile.adapter).length === 0 && !editing && (
        <p className="preset-editor-empty">{t('保存常用名称和 ID，共用当前服务密钥。')}</p>
      )}
      {entries.map(
        (item, index) =>
          item.adapter === profile.adapter && (
            <div className="preset-editor-row" key={`${item.adapter}:${item.value}`}>
              <div>
                <strong>{item.name}</strong>
                <code>{item.value}</code>
              </div>
              <button
                className="icon-button"
                disabled={Boolean(editing)}
                aria-label={t('编辑{0}预设 {1}', t(title), item.name)}
                onClick={() => begin(index)}
              >
                <Pencil size={13} />
              </button>
              <button
                className="icon-button"
                disabled={Boolean(editing)}
                aria-label={t('删除{0}预设 {1}', t(title), item.name)}
                onClick={() => onChange(editProfilePreset(profile, kind, index, null))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ),
      )}
      {editing && (
        <form
          className="preset-editor-form"
          aria-label={t('编辑{0}预设', t(title))}
          onSubmit={(event) => {
            event.preventDefault();
            complete();
          }}
        >
          <input
            aria-label={t('{0}预设名称', t(title))}
            placeholder={t('名称，例如：日常聊天')}
            value={editing.name}
            maxLength={80}
            autoFocus
            onChange={(event) => setEditing({ ...editing, name: event.target.value })}
          />
          <input
            aria-label={t('{0}预设 ID', t(title))}
            placeholder={kind === 'modelPresets' ? 'model-id' : 'voice-id'}
            value={editing.value}
            maxLength={200}
            spellCheck={false}
            onChange={(event) => setEditing({ ...editing, value: event.target.value })}
          />
          {error && (
            <p className="preset-editor-error" role="alert">
              {t(error)}
            </p>
          )}
          <div className="preset-editor-actions">
            <span>{t('完成后点击右上角保存更改')}</span>
            <button
              type="button"
              className="subtle"
              onClick={() => {
                setEditing(null);
                setError('');
              }}
            >
              {t('取消')}
            </button>
            <button type="submit">{t('完成')}</button>
          </div>
        </form>
      )}
    </section>
  );
}
