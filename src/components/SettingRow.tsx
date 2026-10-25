import { t } from '../i18n';
import type { ReactNode } from 'react';

export default function SettingRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="preference-row">
      <div className="preference-copy">
        <h3>{t(title)}</h3>
      </div>
      <div className="preference-control">{children}</div>
    </div>
  );
}
