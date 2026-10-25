import { useRef, useState } from 'react';
import { sidebarDefault, sidebarMinimum } from '../core/sidebar-layout';
import { t } from '../i18n';

export default function SidebarResizeHandle({
  width,
  maximum,
  onChange,
}: {
  width: number;
  maximum: number;
  onChange: (width: number, persist?: boolean) => void;
}) {
  const drag = useRef<{ pointer: number; x: number; width: number; latest: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  function finish() {
    if (!drag.current) return;
    onChange(drag.current.latest);
    drag.current = null;
    setDragging(false);
  }
  return (
    <div
      className={`sidebar-resize-handle${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-label={t('调整侧栏宽度')}
      aria-description={t('左右拖动或使用方向键调整，双击恢复默认宽度。')}
      aria-orientation="vertical"
      aria-valuemin={sidebarMinimum}
      aria-valuemax={maximum}
      aria-valuenow={width}
      tabIndex={0}
      onDoubleClick={() => onChange(sidebarDefault)}
      onKeyDown={(event) => {
        const next =
          event.key === 'ArrowLeft'
            ? width - 10
            : event.key === 'ArrowRight'
              ? width + 10
              : event.key === 'Home'
                ? sidebarMinimum
                : event.key === 'End'
                  ? maximum
                  : null;
        if (next !== null) {
          event.preventDefault();
          onChange(next);
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, x: event.clientX, width, latest: width };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        const next = Math.max(
          sidebarMinimum,
          Math.min(maximum, drag.current.width + event.clientX - drag.current.x),
        );
        drag.current.latest = next;
        onChange(next, false);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    />
  );
}
