import { t } from '../i18n';
import * as Primitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

interface Option {
  value: string;
  label: string;
  group?: string;
  translate?: boolean;
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
  onOpenChange,
  emptyLabel = '暂无可选项',
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
  onOpenChange?: (open: boolean) => void;
  emptyLabel?: string;
}) {
  const groups = [...new Set(options.map((option) => option.group ?? ''))];
  const renderOption = (option: Option) => (
    <Primitive.Item className="select-option" value={option.value} key={option.value}>
      <Primitive.ItemText>
        {option.translate === false ? option.label : t(option.label)}
      </Primitive.ItemText>
      <Primitive.ItemIndicator className="select-check">
        <Check size={14} strokeWidth={2} />
      </Primitive.ItemIndicator>
    </Primitive.Item>
  );
  return (
    <Primitive.Root
      value={value}
      onValueChange={onChange}
      onOpenChange={onOpenChange}
      disabled={disabled}
    >
      <Primitive.Trigger
        aria-label={t(label)}
        className={`select-trigger ${compact ? 'select-compact' : ''}`}
      >
        <Primitive.Value placeholder={t(placeholder)} />
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
          <Primitive.Viewport className="select-options">
            {!options.length && (
              <Primitive.Item className="select-option" value="__empty__" disabled>
                <Primitive.ItemText>{t(emptyLabel)}</Primitive.ItemText>
              </Primitive.Item>
            )}
            {groups.map((group) =>
              group ? (
                <Primitive.Group
                  key={group
                    .split(' · ')
                    .map((part) => t(part))
                    .join(' · ')}
                >
                  <Primitive.Label className="select-group-label">
                    {group
                      .split(' · ')
                      .map((part) => t(part))
                      .join(' · ')}
                  </Primitive.Label>
                  {options.filter((option) => option.group === group).map(renderOption)}
                </Primitive.Group>
              ) : (
                options.filter((option) => !option.group).map(renderOption)
              ),
            )}
          </Primitive.Viewport>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
