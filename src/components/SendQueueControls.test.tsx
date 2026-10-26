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
  it('keeps the entry label short for every phase, count and pause state', () => {
    for (const status of [
      'queued',
      'translating',
      'synthesizing',
      'ready',
      'playing',
      'waitingDevice',
      'decoding',
      'stopping',
    ]) {
      for (const paused of [false, true]) {
        const html = render([status, 'queued'], paused);
        expect(html).toContain('>队列</button>');
        expect(html).not.toContain(' · 2');
        expect(html).not.toContain('播放中');
        expect(html).not.toContain('已暂停');
      }
    }
  });
  it('marks failed items and clears the error indicator once retry is queued', () => {
    const failed = render(['failed', 'queued'], true);
    expect(failed).toContain('has-failure');
    expect(failed).toContain('查看发送队列，有失败项');
    expect(failed).toContain('>队列</button>');
    expect(failed).not.toContain(' · 2');
    expect(render(['queued', 'ready'], true)).not.toContain('has-failure');
    expect(render([])).toBe('');
  });
});
