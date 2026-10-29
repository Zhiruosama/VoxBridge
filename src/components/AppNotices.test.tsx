import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { UpdateView } from '../core/app-update';
const fixture = vi.hoisted(() => ({ view: {} as UpdateView }));
vi.mock('../app-updates', () => ({
  appUpdates: {
    subscribe: () => () => {},
    snapshot: () => fixture.view,
    install: vi.fn(),
    dismissStartupPrompt: vi.fn(),
  },
}));
import AppNotices from './AppNotices';

it.each(['checking', 'downloading', 'waiting', 'countdown', 'installing'] as const)(
  'keeps %s updates visible both with an empty notice and with a regular toast',
  (status) => {
    fixture.view = {
      startupPrompt: true,
      automatic: true,
      downloaded: false,
      seconds: 5,
      status,
      version: '0.5.5',
      percent: 40,
      error: '',
    };
    for (const message of ['', '已保存']) {
      const html = renderToStaticMarkup(
        <AppNotices message={message} noticeId={1} onClose={() => {}} />,
      );
      expect(html).toContain('VoxBridge 0.5.5');
      expect(html).toContain('update-reminder');
      if (message) expect(html).toContain('已保存');
    }
  },
);
