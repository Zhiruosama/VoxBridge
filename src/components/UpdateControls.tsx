import { useSyncExternalStore } from 'react';
import { appUpdates } from '../app-updates';
import { desktop } from '../bridge';
import { t } from '../i18n';
import SettingRow from './SettingRow';
import UpdateProgress, { updateMessage } from './UpdateProgress';
import { LoaderCircle } from 'lucide-react';

export default function UpdateControls({
  automatic,
  onAutomaticChange,
}: {
  automatic: boolean;
  onAutomaticChange: (enabled: boolean) => void;
}) {
  const view = useSyncExternalStore(appUpdates.subscribe, appUpdates.snapshot);
  const working = ['checking', 'downloading', 'waiting', 'countdown', 'installing'].includes(
    view.status,
  );
  return (
    <>
      <SettingRow title={t('自动更新')}>
        <button
          type="button"
          role="switch"
          className="voice-direct-toggle automatic-update-toggle"
          aria-label={t('自动更新')}
          aria-checked={automatic}
          disabled={!desktop || view.status === 'installing'}
          onClick={() => onAutomaticChange(!automatic)}
        >
          <span className="voice-switch-track" aria-hidden="true">
            <span />
          </span>
          <span>{t(automatic ? '已开启' : '已关闭')}</span>
        </button>
      </SettingRow>
      <div className="virtual-mic-help">
        <p>
          {t(
            '开启后，启动时自动检查并下载更新；空闲时倒计时 5 秒后安装并重启。有任务或未保存内容时等待，可点击“稍后”跳过本次自动安装。',
          )}
        </p>
      </div>
      <SettingRow title={t('软件更新')}>
        <button
          className="subtle"
          disabled={!desktop || working}
          onClick={() => void appUpdates.check()}
        >
          {t(view.status === 'checking' ? '正在检查…' : '检查更新')}
        </button>
        {view.version && !['checking', 'latest'].includes(view.status) && (
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
        {view.status !== 'idle' && (
          <div className="update-settings-status">
            <p key={view.status} className="update-phase-copy">
              {working && <LoaderCircle size={14} className="status-spinner" aria-hidden="true" />}
              {updateMessage(view)}
            </p>
            <UpdateProgress view={view} />
          </div>
        )}
        {['waiting', 'countdown'].includes(view.status) && (
          <button className="subtle" onClick={() => appUpdates.dismissStartupPrompt()}>
            {t('稍后')}
          </button>
        )}
        {view.error && <p>{t(view.error)}</p>}
        <p>{t('启动时自动检查更新；安装前会验证签名，并保留原有配置。')}</p>
      </div>
    </>
  );
}
