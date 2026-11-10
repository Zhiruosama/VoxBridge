import { asrLanguages, asrLanguageHint } from '../core/asr-language';
import type { ProviderProfile } from '../core/types';
import { t } from '../i18n';
import Select from './Select';

export default function AsrLanguageSelect({
  value,
  onChange,
  profile,
  disabled,
  label = '识别语言',
}: {
  value: string;
  onChange: (value: string) => void;
  profile: ProviderProfile;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="asr-language-control" title={t(asrLanguageHint(profile, value))}>
      <Select
        label={label}
        valuePrefix={label}
        value={value}
        onChange={onChange}
        disabled={disabled}
        options={asrLanguages.map((language) => ({ value: language, label: language }))}
        compact
      />
    </div>
  );
}
