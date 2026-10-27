import { useOverlayDrag } from '../hooks/useOverlayDrag';
import type { OverlayResizeDirection } from '../bridge';

const directions: OverlayResizeDirection[] = [
  'North',
  'South',
  'East',
  'West',
  'NorthEast',
  'NorthWest',
  'SouthEast',
  'SouthWest',
];
function Handle({
  direction,
  onError,
}: {
  direction: OverlayResizeDirection;
  onError: () => void;
}) {
  const pointer = useOverlayDrag(onError, direction);
  return (
    <div aria-hidden="true" className={`overlay-resize-handle edge-${direction}`} {...pointer} />
  );
}
export default function OverlayResizeHandles({ onError }: { onError: () => void }) {
  return (
    <>
      {directions.map((direction) => (
        <Handle key={direction} direction={direction} onError={onError} />
      ))}
    </>
  );
}
