import { t } from '../i18n';
import type { SettingsSection } from './SettingsPanel';

const groups: [string, string, string[]][] = [
  [
    'appearance-heading',
    '外观',
    ['界面语言', '主题', '关闭主窗口时', '文本翻译面板不透明度', '字幕显示方式', '字幕段落间距'],
  ],
  ['caption-colors-heading', '工作台字幕', ['字号']],
  ['listening-language-heading', '监听字幕', ['识别语言', '字幕语言']],
  [
    'composer-heading',
    '文字表达',
    [
      '录音识别语言',
      '输入语言',
      '输出语言',
      'Enter 操作',
      '语音内容',
      '上下文语气',
      '默认语音输出',
    ],
  ],
  ['text-overlay-heading', '文本翻译悬浮窗', ['背景不透明度', '字号', '行距', '文字颜色']],
  [
    'subtitle-heading',
    '悬浮字幕',
    ['显示方式', '双语字幕', '配色来源', '文字颜色', '行距', '字号', '背景不透明度'],
  ],
  [
    'audio-heading',
    '音频',
    ['监听应用', '发送时试听', '语音输入麦克风', '试听设备', '发送设备', '音频设备与诊断'],
  ],
  ['about-heading', '关于', []],
];

export default function SettingsSearchResults({
  query,
  desktop,
  onOpen,
  onDiagnostics,
}: {
  query: string;
  desktop: boolean;
  onOpen: (section: SettingsSection, anchor: string) => void;
  onDiagnostics: () => void;
}) {
  const entries = groups.flatMap(([anchor, group, labels]) =>
    (labels.length ? labels : [group])
      .filter((label) => desktop || label !== '关闭主窗口时')
      .map((label) => ({
        label,
        group,
        open: () => onOpen('general', labels.length ? anchor + '/' + label : anchor),
      })),
  );
  for (const [stage, group] of [
    ['translation', '文字翻译'],
    ['asr', '语音识别'],
    ['tts', '语音合成'],
  ] as const) {
    for (const [anchor, label] of [
      ['connection-heading', '服务连接'],
      ['credential-heading', 'API 密钥'],
      ...(stage === 'translation' ? [['translation-prompt-heading', '翻译风格']] : []),
    ]) {
      entries.push({ label, group, open: () => onOpen(stage, anchor) });
    }
  }
  entries.push({ label: '音频与诊断', group: '工具', open: onDiagnostics });
  const matches = entries.filter(({ label, group }) =>
    (t(group) + ' ' + t(label)).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <section className="preferences-page settings-results">
      <h1>{t('搜索结果')}</h1>
      {matches.length ? (
        matches.map(({ label, group, open }) => (
          <button key={group + label} onClick={open}>
            <strong>{t(label)}</strong>
            <small>{t(group)}</small>
          </button>
        ))
      ) : (
        <p>{t('未找到匹配的设置')}</p>
      )}
    </section>
  );
}
