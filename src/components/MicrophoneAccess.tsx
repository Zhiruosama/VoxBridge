import { useEffect, useState } from 'react';
import { microphoneAccess, openAudioSettings } from '../bridge';
import { t } from '../i18n';
import SettingRow from './SettingRow';

export default function MicrophoneAccess({ notify }: { notify: (message: string) => void }) {
  const [status, setStatus] = useState('not-applicable');
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void microphoneAccess()
        .then((value) => {
          if (active) setStatus(value);
        })
        .catch(() => {
          if (active) setStatus('unknown');
        });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, []);
  if (status === 'not-applicable') return null;
  return (
    <>
      <SettingRow title={t('麦克风权限')}>
        <span className="preference-value" role="status">
          {t(
            status === 'allowed'
              ? '系统允许访问'
              : status === 'denied'
                ? '系统已禁止访问'
                : '需要在系统设置中确认',
          )}
        </span>
      </SettingRow>
      <div className="virtual-mic-help">
        <p>{t('录音需要允许麦克风访问及桌面应用访问；设备被独占时，请先关闭占用它的软件。')}</p>
        <p className="virtual-mic-credit">
          <button
            className="subtle"
            onClick={() =>
              void openAudioSettings('microphone').catch((error) => notify(String(error)))
            }
          >
            {t('打开麦克风权限设置')}
          </button>
        </p>
      </div>
    </>
  );
}
