import { Check, Palette } from 'lucide-react';
import { subtitleColors } from '../core/overlay';
import { t } from '../i18n';

export default function CaptionColorPicker({
  label,
  customLabel,
  value,
  onChange,
}: {
  label: string;
  customLabel: string;
  value: string;
  onChange: (color: string) => void;
}) {
  const selected = value.toLowerCase();
  return (
    <div className="subtitle-color-options" role="group" aria-label={label}>
      {subtitleColors.map((color, index) => (
        <button
          type="button"
          key={color}
          className="subtitle-color"
          aria-label={t(['白色', '黄色', '绿色', '青色', '橙色', '粉色'][index])}
          aria-pressed={selected === color}
          onClick={() => onChange(color)}
        >
          <span className="subtitle-color-dot" style={{ backgroundColor: color }}>
            {selected === color && <Check size={13} strokeWidth={2.5} aria-hidden="true" />}
          </span>
        </button>
      ))}
      <label className="caption-custom-color" data-selected={!subtitleColors.includes(selected)}>
        <Palette size={17} aria-hidden="true" />
        <span className="caption-custom-color-preview" style={{ backgroundColor: value }} />
        <input
          type="color"
          aria-label={customLabel}
          value={value}
          onInput={(event) => onChange(event.currentTarget.value)}
        />
      </label>
    </div>
  );
}
