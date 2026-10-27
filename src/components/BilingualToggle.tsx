import { t } from '../i18n';

export default function BilingualToggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="bilingual-toggle"
      aria-label={t('双语字幕')}
      aria-description={t('关闭后仅显示译文')}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="bilingual-toggle-track" aria-hidden="true" />
      <span>{label ?? t('双语')}</span>
    </button>
  );
}
