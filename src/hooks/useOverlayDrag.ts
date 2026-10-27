import { useEffect, useRef, type PointerEvent } from 'react';
import { dragOverlay, resizeOverlay, type OverlayResizeDirection } from '../bridge';

type Drag = {
  id: string;
  pointer: number;
  ready: Promise<void>;
  latest: boolean;
  running: boolean;
  ended: boolean;
};
/** Coalesce pointer movement while one native update is in flight. No modal mouse loop. */
export function useOverlayDrag(onError: () => void, direction?: OverlayResizeDirection) {
  const operation = (id: string, phase: 'begin' | 'move' | 'end') =>
    direction ? resizeOverlay(id, phase, direction) : dragOverlay(id, phase);
  const active = useRef<Drag | null>(null);
  async function flush(drag: Drag) {
    if (drag.running) return;
    drag.running = true;
    try {
      await drag.ready;
      while (drag.latest) {
        drag.latest = false;
        // Native macOS samples the cursor in global AppKit points. Sending
        // browser screen deltas creates jumps across displays with different DPI.
        await operation(drag.id, 'move');
      }
      if (drag.ended) {
        await operation(drag.id, 'end');
        if (active.current === drag) active.current = null;
      }
    } catch {
      if (active.current === drag) active.current = null;
      onError();
    } finally {
      drag.running = false;
    }
  }
  useEffect(
    () => () => {
      const drag = active.current;
      if (drag) {
        drag.ended = true;
        void flush(drag);
      }
    },
    [],
  );
  function end(event: PointerEvent<HTMLElement>) {
    const drag = active.current;
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.ended = true;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    void flush(drag);
  }
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0 || active.current || (event.target as Element).closest('button'))
        return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const id = crypto.randomUUID();
      const drag: Drag = {
        id,
        pointer: event.pointerId,
        ready: operation(id, 'begin'),
        latest: false,
        running: false,
        ended: false,
      };
      active.current = drag;
      void flush(drag);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const drag = active.current;
      if (!drag || drag.ended || event.pointerId !== drag.pointer) return;
      drag.latest = true;
      void flush(drag);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
  };
}
