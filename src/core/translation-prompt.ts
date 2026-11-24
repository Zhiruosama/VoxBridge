import prompt from './default-translation-prompt.txt?raw';
import type { ProviderProfile, Settings } from './types';

export const defaultTranslationPrompt = prompt.trim();
export const translationPromptLimit = 4000;

export interface TranslationPromptPreset {
  id: string;
  name: string;
  prompt: string;
}

export const defaultTranslationPromptPresetId = 'builtin:chat';
export const customTranslationPromptPresetLimit = 50;
export const translationPromptPresetNameLimit = 80;

export const builtinTranslationPromptPresets: readonly TranslationPromptPreset[] = [
  {
    id: defaultTranslationPromptPresetId,
    name: 'IG / Discord 聊天（默认）',
    prompt: defaultTranslationPrompt,
  },
  {
    id: 'builtin:math',
    name: '数学',
    prompt:
      '翻译数学课程或讨论，使用教材常用术语和简洁自然的目标语言。根据邻近原文判断术语与指代，同一个对象在不同位置或操作中仍是同一个对象。保留变量、撇号、下标、指数、负号、否定、限定条件和运算顺序，例如用 u′ 表示口述的 u prime。条件概率要分清条件事件和要求概率的事件。每个运算都必须有当前原文支持。如果只说了“第一项和第二项”，就保留这个关系，不根据前文自行补出乘、除或等号。半句保留半句。只输出当前内容的译文。',
  },
  {
    id: 'builtin:medical',
    name: '医疗',
    prompt:
      '翻译医疗沟通或医学资料，使用目标语言通行的医学术语，保留原文的专业或日常语气。准确保留病名、药名、剂量、浓度、给药途径、频次、时点、部位和左右侧，保留原有数值、单位和缩写。明确区分否定、疑似、已证实、既往史和当前症状。仅在上下文明确时展开缩写，保留含义不明的名称或缩写。不推断诊断，不补充用药方法或医学建议。半句按已有内容翻译，只输出译文。',
  },
  {
    id: 'builtin:finance',
    name: '金融',
    prompt:
      '翻译金融、财务或市场讨论，采用目标语言常用的金融与会计术语。准确保留币种、金额、正负号、小数点、量级、百分比、百分点、基点、期间与日期。区分营收与利润、实际值与预测值、同比与环比、上涨与下跌。保留股票代码和产品名称，只在语境明确时展开缩写。保留原文的风险提示、假设和不确定性，不换算币种、不补写遗漏数字、不添加投资建议。半句按已有内容翻译，只输出译文。',
  },
];

export function parseTranslationPromptPresets(value: unknown): TranslationPromptPreset[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > customTranslationPromptPresetLimit)
    throw new Error('最多保存 50 个自建提示词预设。');

  const ids = new Set<string>();
  const names = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('预设格式无效。');
    const fields = item as Record<string, unknown>;
    const { id } = fields;
    const name = typeof fields.name === 'string' ? fields.name.trim() : '';
    const body = typeof fields.prompt === 'string' ? fields.prompt.trim() : '';
    if (typeof id !== 'string' || !/^custom:[a-z\d-]{1,128}$/i.test(id) || ids.has(id))
      throw new Error('预设格式无效。');
    if (!name || [...name].length > translationPromptPresetNameLimit)
      throw new Error('预设名称需要 1–80 个字符。');
    if (!body || [...body].length > translationPromptLimit)
      throw new Error('预设提示词需要 1–4000 个字符。');
    const nameKey = name.toLowerCase();
    if (names.has(nameKey)) throw new Error('已有同名的自建提示词预设。');
    ids.add(id);
    names.add(nameKey);
    return { id, name, prompt: body };
  });
}

export function selectedTranslationPromptPresetId(
  profile: ProviderProfile,
  customPresets: readonly TranslationPromptPreset[],
): string | undefined {
  const body = profile.translationPrompt?.trim() || defaultTranslationPrompt;
  const custom = customPresets.find((preset) => preset.id === profile.translationPromptPresetId);
  if (custom?.prompt === body) return custom.id;
  return builtinTranslationPromptPresets.find((preset) => preset.prompt === body)?.id;
}

export function saveTranslationPromptPreset(
  settings: Settings,
  profileId: string,
  entry: TranslationPromptPreset,
): Settings {
  const presets = parseTranslationPromptPresets([...settings.translationPromptPresets, entry]);
  const saved = presets[presets.length - 1];
  return {
    ...settings,
    translationPromptPresets: presets,
    profiles: settings.profiles.map((profile) =>
      profile.id === profileId && profile.stage === 'translation'
        ? { ...profile, translationPrompt: saved.prompt, translationPromptPresetId: saved.id }
        : profile,
    ),
  };
}

export function removeTranslationPromptPreset(settings: Settings, id: string): Settings {
  if (!settings.translationPromptPresets.some((preset) => preset.id === id)) return settings;
  return {
    ...settings,
    translationPromptPresets: settings.translationPromptPresets.filter(
      (preset) => preset.id !== id,
    ),
    profiles: settings.profiles.map((profile) => {
      if (profile.translationPromptPresetId !== id) return profile;
      const { translationPromptPresetId: _removed, ...rest } = profile;
      return rest;
    }),
  };
}
