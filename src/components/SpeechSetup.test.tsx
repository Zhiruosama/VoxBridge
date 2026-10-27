import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import SpeechSetup from './SpeechSetup';
import { defaults } from '../core/settings';

it('shows actionable fresh-install configuration hints without claiming a disconnected device', () => {
  const html = renderToStaticMarkup(
    <SpeechSetup
      settings={structuredClone(defaults)}
      onSettings={vi.fn()}
      onSource={vi.fn()}
      onVirtual={vi.fn()}
    />,
  );
  expect(html).toContain('检测中…');
  expect(html).not.toContain('设备未就绪');
  expect(html).toContain('请先配置语音合成服务');
  expect(html).toContain('配置文字翻译');
  expect(html).toContain('改发原文并保存');
  expect(html).toContain('不会直通麦克风原声');
});
