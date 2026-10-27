import { useSyncExternalStore } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { appUpdates } from '../app-updates';
import { t, useUiLanguage } from '../i18n';

export default function UpdatePrompt({ suspended = false }: { suspended?: boolean }) {
  useUiLanguage();
  const view = useSyncExternalStore(appUpdates.subscribe, appUpdates.snapshot);
  if (!view.startupPrompt || suspended) return null;
  const working = ['checking', 'downloading', 'installing'].includes(view.status);
  const message =
    view.status === 'downloading'
      ? `${t('正在下载…')}${view.percent !== null ? ` ${view.percent}%` : ''}`
      : view.status === 'installing'
        ? t('正在安装…')
        : t('发现新版本 {0}', view.version);
  return (
    <div className="toast-positioner update-reminder-positioner">
      <div className="toast update-reminder" role="status">
        {working ? (
          <LoaderCircle size={15} className="status-spinner" aria-hidden="true" />
        ) : (
          <Download size={15} aria-hidden="true" />
        )}
        <div className="update-reminder-copy">
          <span>{message}</span>
          {view.error && <span className="update-reminder-error">{t(view.error)}</span>}
        </div>
        <button className="subtle" disabled={working} onClick={() => void appUpdates.install()}>
          {t('更新')}
        </button>
        <button
          className="subtle"
          disabled={working}
          onClick={() => appUpdates.dismissStartupPrompt()}
        >
          {t('稍后')}
        </button>
      </div>
    </div>
  );
}
