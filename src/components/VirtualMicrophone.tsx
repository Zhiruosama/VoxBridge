import { useEffect, useState } from 'react';
import {
  desktop,
  openVirtualMicInstaller,
  openVirtualMicVendor,
  openAudioSettings,
  virtualMicStatus,
  testTone,
} from '../bridge';
import type { OutputDevice, VirtualMicStatus } from '../core/types';
import { t } from '../i18n';
import SettingRow from './SettingRow';
import { virtualMicrophoneOutputId } from '../core/audio-routing';

export default function VirtualMicrophone({
  devices,
  selected,
  savedSelected,
  onSelect,
  onRefresh,
  notify,
}: {
  devices: OutputDevice[];
  selected: string;
  savedSelected: string;
  onSelect: (id: string) => void;
  onRefresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [status, setStatus] = useState<VirtualMicStatus | null>(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [testing, setTesting] = useState(false);
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
  const selectedVirtual = selected === virtualMicrophoneOutputId || selected === status?.output?.id;
  const savedVirtual =
    savedSelected === virtualMicrophoneOutputId || savedSelected === status?.output?.id;
  async function testMicrophone() {
    if (!ready || !status?.output || testing) return;
    setTesting(true);
    try {
      await testTone(status.output.id);
      notify(t('测试音已发送到虚拟麦克风，请在聊天软件的麦克风测试中确认。'));
    } catch (reason) {
      notify(String(reason));
    } finally {
      setTesting(false);
    }
  }
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
            disabled={selectedVirtual}
            onClick={() => onSelect(status.output!.id)}
          >
            {t(
              selectedVirtual
                ? savedVirtual
                  ? '已设为发送设备'
                  : '已选择，保存更改后生效'
                : '用作发送设备',
            )}
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
      {(windows || ready || error || watching) && (
        <div className="virtual-mic-help">
          {error ? (
            <p role="alert">{t(error)}</p>
          ) : ready ? (
            <>
              <p>{t('VoxBridge 将声音发送到所选虚拟输出；聊天软件的麦克风请选择：')}</p>
              <p>
                <strong>{status.inputName}</strong>
              </p>
              {!selectedVirtual && <p>{t('尚未用于发送：请点击“用作发送设备”，再保存更改。')}</p>}
              <p>{t('试听设备请选择真实耳机或扬声器，然后保存更改。')}</p>
              <p>{t('安装驱动不会转发实体麦克风。请在 VoxBridge 中输入或录音并发送语音。')}</p>
              <p className="virtual-mic-credit">
                <button className="subtle" disabled={testing} onClick={() => void testMicrophone()}>
                  {t(testing ? '正在测试…' : '测试虚拟麦克风')}
                </button>
                <span>{t('测试音约 1 秒，通话中对方可能听到。')}</span>
              </p>
            </>
          ) : windows ? (
            <p>
              {t(
                status?.partial
                  ? '仅检测到一端设备，请启用 Windows 声音设置中的 CABLE Input 和 CABLE Output；安装后请先重启电脑，再刷新设备。'
                  : '安装 VB-CABLE 时请允许系统权限，并在安装器中点击 Install Driver。完成后请重启电脑，再回来刷新设备。',
              )}
            </p>
          ) : null}
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
              {ready && (
                <button
                  className="subtle"
                  onClick={() =>
                    void openAudioSettings('devices').catch((error) => notify(String(error)))
                  }
                >
                  {t('设置麦克风名称')}
                </button>
              )}
            </p>
          )}
          {windows && ready && (
            <p>
              {t(
                '可在 Windows 声音设置中选择该输入设备，将名称改为 VoxBridge；驱动仍由 VB-Audio 提供。',
              )}
            </p>
          )}
        </div>
      )}
    </>
  );
}
