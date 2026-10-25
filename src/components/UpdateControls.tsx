import { useSyncExternalStore } from 'react';
import { appUpdates } from '../app-updates';
import { desktop } from '../bridge';
import { t } from '../i18n';
import SettingRow from './SettingRow';

export default function UpdateControls() {
  const view = useSyncExternalStore(appUpdates.subscribe, appUpdates.snapshot);
  const working = ['checking', 'downloading', 'installing'].includes(view.status);
  return (
    <>
      <SettingRow title={t('软件更新')}>
        <button
          className="subtle"
          disabled={!desktop || working}
          onClick={() => void appUpdates.check()}
        >
          {t(view.status === 'checking' ? '正在检查…' : '检查更新')}
        </button>
        {view.version && (
          <button disabled={working} onClick={() => void appUpdates.install()}>
            {t(
              view.status === 'downloading'
                ? '正在下载…'
                : view.status === 'installing'
                  ? '正在安装…'
                  : '更新并重启',
            )}
          </button>
        )}
      </SettingRow>
      <div className="virtual-mic-help" role="status">
        {view.version && (
          <p>
            {t('发现新版本 {0}', view.version)}
            {view.percent !== null && ` · ${view.percent}%`}
          </p>
        )}
        {view.status === 'latest' && <p>{t('当前已是最新版本。')}</p>}
        {view.error && <p>{t(view.error)}</p>}
        <p>{t('启动时自动检查更新；安装前会验证签名，并保留原有配置。')}</p>
      </div>
    </>
  );
}
