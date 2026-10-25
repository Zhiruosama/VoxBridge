import { useState } from 'react';
import { Check, X } from 'lucide-react';
import Select from './Select';

/** Keep preset selection and custom identifiers in a single control. */
export default function PresetSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; group?: string }[];
  onChange: (value: string) => void;
}) {
  const [customValue, setCustomValue] = useState<string | null>(null);
  const confirm = () => {
    if (customValue !== null) onChange(customValue);
    setCustomValue(null);
  };
  return (
    <div className="preset-field">
      {customValue === null ? (
        <Select
          label={label}
          value={value}
          options={[...options, { value: '__manual_identifier__', label: '手动输入…' }]}
          placeholder={`选择${label}`}
          onChange={(next) => {
            if (next === '__manual_identifier__') setCustomValue(value);
            else onChange(next);
          }}
        />
      ) : (
        <div className="preset-custom-input">
          <input
            aria-label={`自定义${label}`}
            value={customValue}
            placeholder={`输入${label}标识`}
            spellCheck={false}
            autoFocus
            onChange={(event) => setCustomValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                confirm();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setCustomValue(null);
              }
            }}
          />
          <button
            className="icon-button"
            aria-label={`确认${label}`}
            aria-description="确认"
            onClick={confirm}
          >
            <Check size={14} />
          </button>
          <button
            className="icon-button"
            aria-label={`取消编辑${label}`}
            aria-description="取消"
            onClick={() => setCustomValue(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
