import { afterEach, describe, expect, it } from 'vitest';
import ts from 'typescript';
import english from './en.json';
import russian from './ru.json';
import { parseUiLanguage, setUiLanguage, t } from './index';
import { defaults, parseSettings } from '../core/settings';
import { overlaySnapshot } from '../core/overlay';

afterEach(() => setUiLanguage('zh-CN'));

describe('interface language', () => {
  it('persists Russian and localizes diagnostics without changing user content or API settings', () => {
    const original = structuredClone(defaults);
    const parsed = parseSettings({ ...original, uiLanguage: 'ru' });
    expect(parsed.uiLanguage).toBe('ru');
    expect(parsed.profiles).toEqual(original.profiles);
    expect(parsed.sourceLanguage).toBe(original.sourceLanguage);
    setUiLanguage('ru');
    expect(t('设置')).toBe('Настройки');
    expect(t('OpenAI 语音识别')).toBe('Распознавание речи OpenAI');
    expect(t('ASR 认证失败或无模型权限，请检查密钥与账号。（HTTP 401）')).toBe(
      'Ошибка авторизации распознавания или нет доступа к модели. Проверьте ключ и аккаунт. （HTTP 401）',
    );
    expect(t('目标：英语；返回语言识别：不确定')).toBe(
      'Целевой язык: Английский; определённый язык: Не определён',
    );
    expect(t('Error: 请输入模型 ID。 请到设置页完善文字翻译服务。')).not.toMatch(/[\u3400-\u9fff]/);
    expect(t('private-model-id')).toBe('private-model-id');
    expect(t('选择{0}', 'Мой голос')).toContain('Мой голос');
    expect(
      overlaySnapshot(
        { id: 'test', segments: [] },
        'running',
        defaults.subtitle,
        1,
        defaults.captionColors,
        'ru',
      ).uiLanguage,
    ).toBe('ru');
  });
  it('covers the full English catalog in Russian and preserves every placeholder', () => {
    const catalog: Record<string, string> = russian;
    for (const [key, value] of Object.entries(english)) {
      expect(catalog[key], key).toBeTruthy();
      expect([...catalog[key].matchAll(/\{\d+\}/g)].map((m) => m[0]).sort(), key).toEqual(
        [...value.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort(),
      );
      expect(catalog[key], key).not.toMatch(/[\u3400-\u9fff]/);
    }
  });
  it('covers installer and uninstaller interface copy in Russian', () => {
    const files = import.meta.glob<string>(
      ['../components/Setup.tsx', '../components/Uninstall.tsx'],
      {
        query: '?raw',
        import: 'default',
        eager: true,
      },
    );
    for (const [file, contents] of Object.entries(files)) {
      const source = ts.createSourceFile(
        file,
        contents,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      function check(argument: ts.Expression) {
        if (ts.isStringLiteral(argument)) {
          expect(Object.hasOwn(russian, argument.text), `${file}: ${argument.text}`).toBe(true);
        } else if (ts.isConditionalExpression(argument)) {
          check(argument.whenTrue);
          check(argument.whenFalse);
        }
      }
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(source) === 'text' &&
          node.arguments[0]
        ) {
          check(node.arguments[0]);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  });
  it('migrates existing settings to Chinese and preserves all provider language parameters', () => {
    const original = structuredClone(defaults);
    const legacy = { ...original, uiLanguage: undefined };
    expect(parseSettings(legacy).uiLanguage).toBe('zh-CN');
    const changed = parseSettings({ ...original, uiLanguage: 'en' });
    expect(changed.uiLanguage).toBe('en');
    expect(changed.sourceLanguage).toBe(original.sourceLanguage);
    expect(changed.targetLanguage).toBe(original.targetLanguage);
    expect(changed.listening).toEqual(original.listening);
    expect(changed.profiles).toEqual(original.profiles);
    expect(parseUiLanguage('fr')).toBe('zh-CN');
  });
  it('switches UI text in both directions and interpolates data without translating it', () => {
    expect(t('设置')).toBe('设置');
    setUiLanguage('en');
    expect(t('设置')).toBe('Settings');
    expect(t('删除“{0}”及已保存的密钥？删除会立即保存，无法撤销。', '我的私有音色')).toContain(
      '我的私有音色',
    );
    expect(t('constructor')).toBe('constructor');
    expect(t('private-model-id')).toBe('private-model-id');
    expect(t('Error: 请输入模型 ID。 请到设置页完善文字翻译服务。')).toBe(
      'Error: Enter a model ID. Complete your translation service settings.',
    );
    expect(
      t('翻译服务未返回有效译文，请重试或更换模型。 目标：英语；返回语言识别：不确定'),
    ).not.toMatch(/[\u3400-\u9fff]/);
    setUiLanguage('zh-CN');
    expect(t('设置')).toBe('设置');
  });
  it('syncs the floating UI language without changing source captions or translations', () => {
    const session = {
      id: 'session',
      segments: [
        {
          id: 'one',
          revision: 1,
          final: true,
          time: '00:01',
          source: '设置',
          translation: 'Do not translate this UI-like caption',
        },
      ],
    };
    const snapshot = overlaySnapshot(
      session,
      'running',
      defaults.subtitle,
      1,
      defaults.captionColors,
      'en',
    );
    expect(snapshot.uiLanguage).toBe('en');
    expect(snapshot.lines[0].source).toBe('设置');
    expect(snapshot.lines[0].translation).toBe(session.segments[0].translation);
  });
  it('has English copy for every explicit UI translation key and preserves placeholders', () => {
    const files = import.meta.glob<string>(['../components/*.tsx', '../App.tsx'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const catalog: Record<string, string> = english;
    for (const [file, contents] of Object.entries(files)) {
      const source = ts.createSourceFile(
        file,
        contents,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(source) === 't' &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          const key = node.arguments[0].text;
          expect(Object.hasOwn(catalog, key), `${file}: ${key}`).toBe(true);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    for (const [key, value] of Object.entries(catalog)) {
      expect(value.trim(), key).not.toBe('');
      expect([...value.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort(), key).toEqual(
        [...key.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort(),
      );
    }
  });
});
