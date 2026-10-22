import * as Primitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

/** Shared desktop select: consistent styling, keyboard navigation and managed focus. */
export default function Select({
  value,
  onChange,
  options,
  label,
  placeholder = '请选择',
  disabled = false,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <Primitive.Root value={value} onValueChange={onChange} disabled={disabled}>
      <Primitive.Trigger
        aria-label={label}
        className={`select-trigger ${compact ? 'select-compact' : ''}`}
      >
        <Primitive.Value placeholder={placeholder} />
        <Primitive.Icon className="select-chevron">
          <ChevronDown size={14} />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          className="select-menu"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          align="start"
        >
          <Primitive.ScrollUpButton className="select-scroll">
            <ChevronUp size={14} />
          </Primitive.ScrollUpButton>
          <Primitive.Viewport className="select-options">
            {options.map((option) => (
              <Primitive.Item className="select-option" value={option.value} key={option.value}>
                <Primitive.ItemText>{option.label}</Primitive.ItemText>
                <Primitive.ItemIndicator className="select-check">
                  <Check size={14} strokeWidth={2} />
                </Primitive.ItemIndicator>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className="select-scroll">
            <ChevronDown size={14} />
          </Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
