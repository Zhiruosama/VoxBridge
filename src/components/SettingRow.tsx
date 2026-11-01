import { t } from '../i18n';
import type { ReactNode } from 'react';

export default function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="preference-row">
      <div className="preference-copy">
        <h3>{t(title)}</h3>
        {description && <p>{t(description)}</p>}
      </div>
      <div className="preference-control">{children}</div>
    </div>
  );
}
