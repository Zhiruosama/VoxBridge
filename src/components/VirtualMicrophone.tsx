import { useEffect, useState } from 'react';
import {
  desktop,
  openVirtualMicInstaller,
  openVirtualMicVendor,
  virtualMicStatus,
} from '../bridge';
import type { OutputDevice, VirtualMicStatus } from '../core/types';
import { t } from '../i18n';
import SettingRow from './SettingRow';

export default function VirtualMicrophone({
  devices,
  selected,
  onSelect,
  onRefresh,
  notify,
}: {
  devices: OutputDevice[];
  selected: string;
  onSelect: (id: string) => void;
  onRefresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [status, setStatus] = useState<VirtualMicStatus | null>(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    const started = Date.now();
    async function check() {
      if (pending) return;
      pending = true;
      try {
        const next = await virtualMicStatus();
        if (!active) return;
        setStatus(next);
        setError('');
        if (watching && next.output && next.inputName && !next.partial) {
          setWatching(false);
          await onRefresh();
          notify(t('虚拟麦克风已就绪，请用作发送设备并保存更改。'));
        } else if (watching && Date.now() - started > 10 * 60 * 1000) {
          setWatching(false);
        }
      } catch (reason) {
        if (active) setError(String(reason));
      } finally {
        pending = false;
      }
    }
    void check();
    window.addEventListener('focus', check);
    const timer = watching ? window.setInterval(check, 2000) : undefined;
    return () => {
      active = false;
      window.removeEventListener('focus', check);
      window.clearInterval(timer);
    };
    // Device refreshes and installer completion both trigger a fresh native inventory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, watching]);

  const ready = !!status?.output && !!status.inputName && !status.partial && !error;
  const windows = status?.provider === 'vb-cable';
  async function install() {
    setOpening(true);
    try {
      await openVirtualMicInstaller();
      setWatching(!ready);
      notify(
        t(
          ready && windows
            ? '驱动管理器已打开，卸载请点击 Remove Driver；完成后按提示重启电脑。'
            : '安装器已打开，请按提示安装；安装完成后按驱动要求重启电脑。',
        ),
      );
    } catch (reason) {
      notify(String(reason));
    } finally {
      setOpening(false);
    }
  }
  return (
    <>
      <SettingRow title={t('虚拟麦克风')}>
        <span className="preference-value" role="status">
          {error
            ? t('检测失败')
            : !status
              ? t('检测中…')
              : ready
                ? (windows ? 'VB-CABLE' : 'VoxBridge') + ' · ' + t('已就绪')
                : status.partial
                  ? t('设备未完整就绪')
                  : t('尚未安装')}
        </span>
        {ready ? (
          <button
            className="subtle"
            disabled={selected === status.output!.id}
            onClick={() => onSelect(status.output!.id)}
          >
            {t(selected === status.output!.id ? '已设为发送设备' : '用作发送设备')}
          </button>
        ) : (
          <button
            className="subtle"
            disabled={
              !desktop || opening || !status || status.provider === 'unsupported' || status.partial
            }
            onClick={() => void install()}
          >
            {t(opening ? '正在打开…' : '安装虚拟麦克风')}
          </button>
        )}
      </SettingRow>
      {(windows || error) && (
        <div className="virtual-mic-help">
          {error ? (
            <p role="alert">{t(error)}</p>
          ) : ready ? (
            <>
              <p>{t('VoxBridge 发送声音到 CABLE Input；聊天软件的麦克风请选择：')}</p>
              <p>
                <strong>{status.inputName}</strong>
              </p>
              <p>{t('试听设备请选择真实耳机或扬声器，然后保存更改。')}</p>
            </>
          ) : (
            <p>
              {t(
                status?.partial
                  ? '仅检测到一端设备，请启用 Windows 声音设置中的 CABLE Input 和 CABLE Output；安装后请先重启电脑，再刷新设备。'
                  : '安装 VB-CABLE 时请允许系统权限，并在安装器中点击 Install Driver。完成后请重启电脑，再回来刷新设备。',
              )}
            </p>
          )}
          {watching && <p role="status">{t('正在等待虚拟麦克风就绪…')}</p>}
          {windows && (
            <p className="virtual-mic-credit">
              <span>VB-CABLE · VB-Audio · www.vb-cable.com · {t('捐赠软件，欢迎支持作者。')}</span>
              <button
                className="subtle"
                onClick={() => void openVirtualMicVendor().catch((e) => notify(String(e)))}
              >
                {t('官网与捐赠')}
              </button>
              {ready && (
                <button className="subtle" disabled={opening} onClick={() => void install()}>
                  {t(opening ? '正在打开…' : '安装或卸载驱动')}
                </button>
              )}
            </p>
          )}
        </div>
      )}
    </>
  );
}
