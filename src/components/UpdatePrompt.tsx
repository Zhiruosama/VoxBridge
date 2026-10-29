import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { appUpdates } from '../app-updates';
import { t, useUiLanguage } from '../i18n';
import UpdateProgress, { updateMessage } from './UpdateProgress';

export default function UpdatePrompt() {
  useUiLanguage();
  const view = useSyncExternalStore(appUpdates.subscribe, appUpdates.snapshot, appUpdates.snapshot);
  const visible = view.startupPrompt;
  const [present, setPresent] = useState(visible);
  useEffect(() => {
    if (visible) {
      setPresent(true);
      return;
    }
    const timer = setTimeout(() => setPresent(false), 180);
    return () => clearTimeout(timer);
  }, [visible]);
  if (!present && !visible) return null;
  const working = ['checking', 'downloading', 'waiting', 'countdown', 'installing'].includes(
    view.status,
  );
  const dismissDisabled = ['downloading', 'installing'].includes(view.status);
  return (
    <div className="toast-positioner update-reminder-positioner">
      <div
        className={`toast update-reminder${visible ? '' : ' is-leaving'}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        inert={!visible}
      >
        {working ? (
          <LoaderCircle size={15} className="status-spinner" aria-hidden="true" />
        ) : (
          <Download size={15} aria-hidden="true" />
        )}
        <div className="update-reminder-copy">
          <strong>{view.version ? `VoxBridge ${view.version}` : t('软件更新')}</strong>
          <span key={view.status} className="update-phase-copy">
            {updateMessage(view)}
          </span>
          <UpdateProgress view={view} />
          {view.error && <span className="update-reminder-error">{t(view.error)}</span>}
        </div>
        {!working && (
          <button className="subtle" onClick={() => void appUpdates.install()}>
            {t('更新')}
          </button>
        )}
        <button
          className="subtle"
          disabled={dismissDisabled}
          onClick={() => appUpdates.dismissStartupPrompt()}
        >
          {t('稍后')}
        </button>
      </div>
    </div>
  );
}
