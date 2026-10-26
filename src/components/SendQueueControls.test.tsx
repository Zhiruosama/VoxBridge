import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { QueueView } from '../core/send-queue';
import SendQueueControls from './SendQueueControls';

function render(statuses: string[], paused = false) {
  const view: QueueView = {
    paused,
    items: statuses.map((status, index) => ({
      id: String(index),
      text: 'test',
      status,
      error: status === 'failed' ? 'failed' : '',
      active: false,
      targetLanguage: '日语',
    })),
  };
  return renderToStaticMarkup(<SendQueueControls view={view} onAction={() => {}} />);
}
describe('queue entry', () => {
  it('shows progress and pending count without opening the queue', () => {
    expect(render(['queued', 'ready'])).toContain('待处理 · 2');
    expect(render(['translating', 'ready'])).toContain('翻译中 · 2');
    expect(render(['synthesizing'])).toContain('合成中 · 1');
    expect(render(['playing'])).toContain('播放中 · 1');
    expect(render(['queued', 'ready'], true)).toContain('已暂停 · 2');
  });
  it('marks failed items and clears the error indicator once retry is queued', () => {
    const failed = render(['failed', 'queued'], true);
    expect(failed).toContain('has-failure');
    expect(failed).toContain('查看发送队列，有失败项');
    expect(failed).toContain('有失败项 · 2');
    expect(render(['queued', 'ready'], true)).not.toContain('has-failure');
    expect(render([])).toBe('');
  });
});
