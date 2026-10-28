import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AudioLines, Check, Copy, Folder, LoaderCircle, Minus, Square, X } from 'lucide-react';
import './Setup.css';

export default function Uninstall() {
  const [info, setInfo] = useState<{ path: string; driver: boolean; language: string } | null>(
    null,
  );
  const [english, setEnglish] = useState(false);
  const [removeData, setRemoveData] = useState(false);
  const [removeDriver, setRemoveDriver] = useState(false);
  const [phase, setPhase] = useState<'ready' | 'checking' | 'busy' | 'done'>('ready');
  const [error, setError] = useState('');
  const [maximized, setMaximized] = useState(false);
  const busy = phase === 'busy' || phase === 'checking';
  const text = (zh: string, en: string) => (english ? en : zh);
  async function inspect() {
    try {
      const next = await invoke<{ path: string; driver: boolean; language: string }>(
        'setup_inspect',
      );
      setInfo(next);
      setEnglish(next.language !== 'zh');
      setError('');
    } catch {
      setError(
        text('无法读取卸载信息，请重试。', 'Could not read installation details. Please retry.'),
      );
    }
  }
  useEffect(() => {
    document.documentElement.dataset.theme = 'dark';
    void inspect();
    const appWindow = getCurrentWindow();
    let active = true;
    let off: (() => void) | undefined;
    const sync = () => {
      void appWindow
        .isMaximized()
        .then((value) => {
          if (active) setMaximized(value);
        })
        .catch(() => {});
    };
    sync();
    void appWindow.onResized(sync).then((next) => {
      if (active) off = next;
      else next();
    });
    return () => {
      active = false;
      off?.();
    };
  }, []);
  async function control(action: 'minimize' | 'maximize' | 'close') {
    try {
      const window = getCurrentWindow();
      if (action === 'minimize') await window.minimize();
      else if (action === 'maximize') {
        await window.toggleMaximize();
        setMaximized(await window.isMaximized());
      } else await window.close();
    } catch {
      setError(text('无法操作窗口，请重试。', 'Could not control the window. Please retry.'));
    }
  }
  async function uninstall() {
    if (!info || busy) return;
    setError('');
    setPhase('checking');
    let off: (() => void) | undefined;
    try {
      off = await listen('voxbridge:uninstall-started', () => setPhase('busy'));
      await invoke('setup_uninstall', { removeData, removeDriver });
      setPhase('done');
    } catch (e) {
      setError(String(e));
      setPhase('ready');
    } finally {
      off?.();
    }
  }
  async function finish() {
    try {
      await invoke('setup_finish', { open: false });
    } catch {
      setError(text('请点击右上角关闭窗口。', 'Close this window to finish.'));
    }
  }
  return (
    <div className="setup-shell">
      <header className="window-chrome" data-tauri-drag-region>
        <span className="window-chrome-brand" data-tauri-drag-region>
          <AudioLines size={16} />
          VoxBridge
        </span>
        <div className="window-chrome-drag" data-tauri-drag-region />
        <div className="window-controls">
          <button aria-label={text('最小化', 'Minimize')} onClick={() => void control('minimize')}>
            <Minus size={15} />
          </button>
          <button
            aria-label={maximized ? text('还原窗口', 'Restore window') : text('最大化', 'Maximize')}
            onClick={() => void control('maximize')}
          >
            {maximized ? <Copy size={13} /> : <Square size={13} />}
          </button>
          <button
            aria-label={text('关闭', 'Close')}
            disabled={busy}
            onClick={() => void control('close')}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <aside className="setup-sidebar">
        <div className="setup-sidebar-brand">
          <AudioLines size={24} />
          <strong>VoxBridge</strong>
        </div>
        <p>{text('让交流跨越语言', 'Conversations beyond language')}</p>
        <nav aria-label={text('卸载进度', 'Uninstall progress')}>
          {[
            text('卸载选项', 'Your choices'),
            text('正在卸载', 'Uninstalling'),
            text('卸载完成', 'Finished'),
          ].map((label, index) => {
            const current = phase === 'ready' || phase === 'checking' ? 0 : busy ? 1 : 2;
            return (
              <div
                key={label}
                className={index === current ? 'setup-step active' : 'setup-step'}
                aria-current={index === current ? 'step' : undefined}
              >
                <span>{index < current ? <Check size={14} /> : index + 1}</span>
                {label}
              </div>
            );
          })}
        </nav>
        <span className="setup-platform">Windows · {text('桌面版', 'Desktop')}</span>
      </aside>
      <main className="setup-content">
        <div className="setup-language">
          <button disabled={busy} onClick={() => setEnglish(!english)}>
            {english ? '简体中文' : 'English'}
          </button>
        </div>
        {phase === 'ready' || phase === 'checking' ? (
          <>
            <h1>{text('卸载 VoxBridge', 'Uninstall VoxBridge')}</h1>
            <p className="setup-description">
              {text(
                '选择要保留的内容，再开始卸载。请先退出 VoxBridge。',
                'Choose what to keep before uninstalling. Quit VoxBridge first.',
              )}
            </p>
            <section className="setup-card">
              <label>{text('卸载位置', 'Installation folder')}</label>
              <div className="setup-path-row">
                <Folder size={17} />
                <span className="uninstall-path">{info?.path ?? '…'}</span>
              </div>
              <div className="setup-option">
                <div>
                  <strong>{text('清除个人配置与密钥', 'Remove personal settings and keys')}</strong>
                  <p>
                    {text(
                      '默认保留。勾选后会删除服务配置、密钥与外观偏好，无法撤销。',
                      'Kept by default. Selecting this permanently deletes service settings, keys and appearance preferences.',
                    )}
                  </p>
                </div>
                <input
                  type="checkbox"
                  aria-label={text('清除个人配置与密钥', 'Remove personal settings and keys')}
                  checked={removeData}
                  disabled={busy}
                  onChange={(e) => setRemoveData(e.target.checked)}
                />
              </div>
              <div className="setup-option">
                <div>
                  <strong>{text('虚拟麦克风驱动', 'Virtual microphone driver')}</strong>
                  <p>
                    {info?.driver
                      ? text(
                          '默认保留 VB-CABLE。勾选后打开官方管理器，请手动点击 Remove Driver；其他软件可能仍在使用此驱动。',
                          'VB-CABLE is kept by default. Select to open its manager, then click Remove Driver. Other apps may still use it.',
                        )
                      : text('未检测到 VB-CABLE，无需处理。', 'VB-CABLE was not detected.')}
                  </p>
                </div>
                <input
                  type="checkbox"
                  aria-label={text('打开驱动卸载管理器', 'Open driver removal manager')}
                  checked={removeDriver}
                  disabled={busy || !info?.driver}
                  onChange={(e) => setRemoveDriver(e.target.checked)}
                />
              </div>
            </section>
            <p className="setup-preserve">
              <Check size={15} />
              {removeData
                ? text(
                    '将按你的选择清除个人配置与密钥。',
                    'Your personal settings and keys will be removed.',
                  )
                : text(
                    '你的设置、服务配置和密钥都会保留。',
                    'Your settings, service profiles and keys will be kept.',
                  )}
            </p>
          </>
        ) : (
          <div className="setup-state">
            {busy ? (
              <LoaderCircle className="setup-spinner" size={40} />
            ) : (
              <span className="setup-success">
                <Check size={32} />
              </span>
            )}
            <h1>
              {busy ? text('正在卸载', 'Uninstalling') : text('卸载已完成', 'Uninstall complete')}
            </h1>
            <p>
              {busy
                ? text(
                    '正在移除应用文件与快捷方式，请稍候。',
                    'Removing app files and shortcuts. Please wait.',
                  )
                : text(
                    'VoxBridge 已从电脑中移除。',
                    'VoxBridge has been removed from this computer.',
                  )}
            </p>
            {!busy && (
              <p>
                {removeData
                  ? text('个人配置与密钥已清除。', 'Personal settings and keys were removed.')
                  : text(
                      '个人配置与密钥已保留，重新安装后可以继续使用。',
                      'Your settings and keys are kept for your next installation.',
                    )}
              </p>
            )}
          </div>
        )}
        {error && (
          <div className="setup-error" role="alert">
            {error}
            {!info && <button onClick={() => void inspect()}>{text('重试', 'Retry')}</button>}
          </div>
        )}
        <footer className="setup-footer">
          <span>
            {busy ? text('请保持卸载器开启', 'Please keep this window open') : 'VoxBridge Desktop'}
          </span>
          <div className="uninstall-actions">
            {phase === 'ready' && (
              <button onClick={() => void control('close')}>{text('取消', 'Cancel')}</button>
            )}
            <button
              className="primary"
              disabled={busy || (!info && phase !== 'done')}
              onClick={() => void (phase === 'done' ? finish() : uninstall())}
            >
              {phase === 'checking'
                ? text('正在检查…', 'Checking…')
                : busy
                  ? text('卸载中…', 'Uninstalling…')
                  : phase === 'done'
                    ? text('完成', 'Finish')
                    : text('卸载', 'Uninstall')}
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}
