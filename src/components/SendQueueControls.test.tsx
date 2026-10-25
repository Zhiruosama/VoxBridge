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
  it('keeps the visible label constant for multiple items and paused queues', () => {
    for (const paused of [false, true]) {
      const html = render(['queued', 'queued', 'ready'], paused);
      expect(html).toContain('>队列</button>');
      expect(html).not.toContain('已暂停');
      expect(html).not.toContain('队列 3');
      expect(html).not.toContain('has-failure');
    }
  });
  it('marks failed items and clears the error indicator once retry is queued', () => {
    const failed = render(['failed', 'queued'], true);
    expect(failed).toContain('has-failure');
    expect(failed).toContain('查看发送队列，有失败项');
    expect(failed).toContain('>队列</button>');
    expect(render(['queued', 'ready'], true)).not.toContain('has-failure');
    expect(render([])).toBe('');
  });
});
