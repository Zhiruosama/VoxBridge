import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointerEvent } from 'react';
const mocks = vi.hoisted(() => ({ drag: vi.fn(), resize: vi.fn(), cleanup: [] as (() => void)[] }));
vi.mock('../bridge', () => ({ dragOverlay: mocks.drag, resizeOverlay: mocks.resize }));
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => () => void) => {
    mocks.cleanup.push(effect());
  },
}));
import { useOverlayDrag } from './useOverlayDrag';
function pointer(button = 0) {
  const capture = {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  };
  return {
    button,
    pointerId: 1,
    target: { closest: () => null },
    currentTarget: capture,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent<HTMLElement>;
}
async function settle() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}
beforeEach(() => {
  mocks.drag.mockReset().mockResolvedValue(undefined);
  mocks.resize.mockReset().mockResolvedValue(undefined);
  mocks.cleanup.length = 0;
});
describe('overlay move and resize pointer lifecycle', () => {
  it('routes all resize edges to the resize command, not window movement', async () => {
    for (const direction of [
      'North',
      'South',
      'East',
      'West',
      'NorthEast',
      'NorthWest',
      'SouthEast',
      'SouthWest',
    ] as const) {
      const hook = useOverlayDrag(vi.fn(), direction);
      const event = pointer();
      hook.onPointerDown(event);
      await settle();
      hook.onPointerMove(event);
      await settle();
      hook.onPointerUp(event);
      await settle();
      const calls = mocks.resize.mock.calls.slice(-3);
      expect(calls.map((call) => call[1])).toEqual(['begin', 'move', 'end']);
      expect(calls.every((call) => call[0] === calls[0][0] && call[2] === direction)).toBe(true);
      expect(event.currentTarget.releasePointerCapture).toHaveBeenCalledOnce();
    }
    expect(mocks.drag).not.toHaveBeenCalled();
  });
  it('coalesces movement while begin is pending and ends once after pointer capture is lost', async () => {
    let ready!: () => void;
    mocks.resize.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    const hook = useOverlayDrag(vi.fn(), 'SouthEast');
    const event = pointer();
    hook.onPointerDown(event);
    for (let i = 0; i < 20; i++) hook.onPointerMove(event);
    hook.onPointerUp(event);
    hook.onLostPointerCapture(event);
    expect(mocks.resize).toHaveBeenCalledOnce();
    ready();
    await settle();
    expect(mocks.resize.mock.calls.map((call) => call[1])).toEqual(['begin', 'move', 'end']);
  });
  it('cleans up an active gesture and retains the existing toolbar drag route', async () => {
    const hook = useOverlayDrag(vi.fn());
    hook.onPointerDown(pointer(2));
    expect(mocks.drag).not.toHaveBeenCalled();
    hook.onPointerDown(pointer());
    await settle();
    mocks.cleanup[0]();
    await settle();
    expect(mocks.drag.mock.calls.map((call) => call[1])).toEqual(['begin', 'end']);
    expect(mocks.resize).not.toHaveBeenCalled();
  });
});
