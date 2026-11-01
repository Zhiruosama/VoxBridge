import type { Adapter, ProfilePreset, ProviderProfile } from './types';

export type PresetKind = 'modelPresets' | 'voicePresets';
export const profilePresetLimit = 50;

function normalize(value: unknown): ProfilePreset {
  if (!value || typeof value !== 'object') throw new Error('预设格式无效。');
  const item = value as Record<string, unknown>;
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const id = typeof item.value === 'string' ? item.value.trim() : '';
  if (!name || [...name].length > 80) throw new Error('预设名称需要 1–80 个字符。');
  if (!id || new TextEncoder().encode(id).length > 200 || /[\u0000-\u001f\u007f]/.test(id))
    throw new Error('预设 ID 需要 1–200 字节，不能包含换行或控制字符。');
  const adapters: Adapter[] = [
    'qwen_chat_asr',
    'openai_audio_transcriptions',
    'qwen_dashscope_asr',
    'openai_audio_speech',
    'minimax_tts_ws',
    'openai_chat_completions',
  ];
  if (!adapters.includes(item.adapter as Adapter)) throw new Error('请先选择服务协议。');
  return { name, value: id, adapter: item.adapter as Adapter };
}

/** Whitelist public fields only, bound stored lists and reject ambiguous duplicate IDs. */
export function parseProfilePresets(value: unknown): ProfilePreset[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > profilePresetLimit)
    throw new Error(`每类最多保存 ${profilePresetLimit} 个预设。`);
  const items = value.map(normalize);
  if (new Set(items.map((item) => `${item.adapter}:${item.value}`)).size !== items.length)
    throw new Error('同一协议下的预设 ID 不能重复。');
  return items;
}

/** Libraries belong to one credential profile; protocol changes never reuse another catalog. */
export function editProfilePreset(
  profile: ProviderProfile,
  kind: PresetKind,
  index: number | null,
  entry: ProfilePreset | null,
): ProviderProfile {
  if (kind === 'voicePresets' && profile.stage !== 'tts')
    throw new Error('当前服务不支持音色预设。');
  const entries = [...(profile[kind] ?? [])];
  if (index !== null && (!Number.isInteger(index) || index < 0 || index >= entries.length))
    throw new Error('该预设已不存在。');
  const previous = index === null ? null : entries[index];
  if (entry) {
    if (entry.adapter !== profile.adapter) throw new Error('预设协议与当前服务不匹配。');
    if (index === null) entries.push(entry);
    else entries[index] = entry;
  } else if (index !== null) entries.splice(index, 1);
  const parsed = parseProfilePresets(entries);
  const field = kind === 'modelPresets' ? 'modelId' : 'voice';
  return {
    ...profile,
    [kind]: parsed,
    ...(entry && previous?.adapter === profile.adapter && profile[field] === previous.value
      ? { [field]: normalize(entry).value }
      : {}),
  };
}
