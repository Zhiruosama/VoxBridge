import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MouseEvent, ReactElement } from 'react';

const native = vi.hoisted(() => ({
  drag: vi.fn().mockResolvedValue(undefined),
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging: native.drag }),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
import MacWindowChrome from './MacWindowChrome';

describe('Mac titlebar gestures', () => {
  beforeEach(() => vi.clearAllMocks());
  it('drags on the first click and requests exactly one animated zoom on the second', () => {
    const header = MacWindowChrome() as ReactElement<{
      onMouseDown: (event: MouseEvent) => void;
      'data-tauri-drag-region'?: unknown;
    }>;
    // Do not also run Tauri's injected default double-click maximize handler.
    expect(header.props['data-tauri-drag-region']).toBeUndefined();
    header.props.onMouseDown({ button: 0, detail: 1 } as MouseEvent);
    header.props.onMouseDown({ button: 0, detail: 2 } as MouseEvent);
    expect(native.drag).toHaveBeenCalledTimes(1);
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith('zoom_main_window');
  });
  it('ignores right clicks and extra clicks in the same gesture', () => {
    const header = MacWindowChrome() as ReactElement<{ onMouseDown: (event: MouseEvent) => void }>;
    header.props.onMouseDown({ button: 2, detail: 2 } as MouseEvent);
    header.props.onMouseDown({ button: 0, detail: 3 } as MouseEvent);
    expect(native.drag).not.toHaveBeenCalled();
    expect(native.invoke).not.toHaveBeenCalled();
  });
});
