import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import SpeechSpeed from './SpeechSpeed';

/** Portalled so the floating caption's clipping never cuts off the slider. */
export default function SpeechSpeedPicker({
  value = 1,
  onChange,
  disabled = false,
}: {
  value?: number;
  onChange: (speed: number) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector('input')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !panel.current?.contains(event.target)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="speech-speed-trigger"
        aria-label={t('调整语速')}
        aria-expanded={open}
        disabled={disabled}
        aria-description={t('语速 {0} 倍 · 下一次生成生效', value.toFixed(2))}
        onClick={() => {
          if (!open && trigger.current) {
            const anchor = trigger.current.getBoundingClientRect();
            setPosition({
              left: Math.max(12, Math.min(anchor.right - 220, window.innerWidth - 232)),
              top: Math.max(12, Math.min(anchor.top - 100, window.innerHeight - 108)),
            });
          }
          setOpen(!open);
        }}
      >
        {value.toFixed(2)}×
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="speech-speed-popover"
            role="group"
            aria-label={t('语速设置')}
            style={position}
          >
            <span>{t('语速')}</span>
            <SpeechSpeed value={value} onChange={onChange} />
          </div>,
          document.body,
        )}
    </>
  );
}
