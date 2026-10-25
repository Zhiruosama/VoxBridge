import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  AudioLines,
  Check,
  ChevronRight,
  Copy,
  Folder,
  LoaderCircle,
  Minus,
  Square,
  X,
} from 'lucide-react';
import './Setup.css';

type Info = { path: string; upgrade: boolean; driver: boolean; language: string };
export default function Setup() {
  const [info, setInfo] = useState<Info | null>(null);
  const [path, setPath] = useState('');
  const [english, setEnglish] = useState(false);
  const [driver, setDriver] = useState(false);
  const [shortcut, setShortcut] = useState(true);
  const [open, setOpen] = useState(true);
  const [phase, setPhase] = useState<'ready' | 'installing' | 'done'>('ready');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const text = (zh: string, en: string) => (english ? en : zh);
  const busy = phase === 'installing';
  async function inspect() {
    try {
      const next = await invoke<Info>('setup_inspect');
      setInfo(next);
      setPath(next.path);
      setEnglish(next.language !== 'zh');
      setError('');
    } catch {
      setError(
        text('无法读取安装信息，请重试。', 'Could not read installation details. Please retry.'),
      );
    }
  }
  useEffect(() => {
    document.documentElement.dataset.theme = 'dark';
    void inspect();
  }, []);
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let active = true;
    let unlisten: (() => void) | undefined;
    async function sync() {
      try {
        const next = await appWindow.isMaximized();
        if (active) setMaximized(next);
      } catch {
        if (active) setError('无法读取窗口状态，请重试。');
      }
    }
    void sync();
    void appWindow
      .onResized(sync)
      .then((off) => {
        if (active) unlisten = off;
        else off();
      })
      .catch(() => {
        if (active) setError('无法读取窗口状态，请重试。');
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);
  async function choose() {
    setChoosing(true);
    try {
      const next = await invoke<string | null>('setup_choose_folder');
      if (next) setPath(next);
    } catch {
      setError(
        text(
          '无法打开文件夹选择器，请直接输入安装路径。',
          'Could not open the folder picker. Enter a path instead.',
        ),
      );
    } finally {
      setChoosing(false);
    }
  }
  async function install() {
    if (!info || busy) return;
    setError('');
    setPhase('installing');
    try {
      const result = await invoke<{ driverWarning: boolean }>('setup_install', {
        path,
        driver,
        desktopShortcut: shortcut,
      });
      setWarning(result.driverWarning);
      setPhase('done');
    } catch (e) {
      setError(String(e));
      setPhase('ready');
    }
  }
  async function finish() {
    try {
      await invoke('setup_finish', { open });
    } catch {
      setError(text('无法打开应用，请从开始菜单启动。', 'Open VoxBridge from the Start menu.'));
    }
  }
  async function control(action: 'minimize' | 'maximize' | 'close') {
    try {
      if (action === 'minimize') await getCurrentWindow().minimize();
      else if (action === 'maximize') {
        await getCurrentWindow().toggleMaximize();
        setMaximized(await getCurrentWindow().isMaximized());
      } else await getCurrentWindow().close();
    } catch {
      setError(text('无法操作窗口，请重试。', 'Could not control the window. Please retry.'));
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
            title={maximized ? text('还原窗口', 'Restore window') : text('最大化', 'Maximize')}
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
        <nav aria-label={text('安装进度', 'Installation progress')}>
          {[
            text('安装准备', 'Get ready'),
            text('正在安装', 'Installing'),
            text('准备就绪', 'Ready to go'),
          ].map((label, index) => {
            const current = phase === 'ready' ? 0 : busy ? 1 : 2;
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
        {phase === 'ready' ? (
          <>
            <h1>
              {text(
                info?.upgrade ? '更新 VoxBridge' : '安装 VoxBridge',
                info?.upgrade ? 'Update VoxBridge' : 'Install VoxBridge',
              )}
            </h1>
            <p className="setup-description">
              {text(
                info?.upgrade
                  ? '更新应用，继续使用熟悉的配置。'
                  : '实时双语字幕与语音，让每一次交流更轻松。',
                info?.upgrade
                  ? 'A fresh version, with your settings kept in place.'
                  : 'Live captions and speech for easier conversations.',
              )}
            </p>
            <section className="setup-card">
              <label htmlFor="setup-path">{text('安装位置', 'Installation folder')}</label>
              <div className="setup-path-row">
                <Folder size={17} />
                <input
                  id="setup-path"
                  value={path}
                  disabled={!info || choosing}
                  onChange={(e) => setPath(e.target.value)}
                />
                <button disabled={!info || choosing} onClick={() => void choose()}>
                  {text('更改', 'Change')}
                </button>
              </div>
              <div className="setup-option">
                <div>
                  <strong>{text('桌面快捷方式', 'Desktop shortcut')}</strong>
                  <p>{text('在桌面上快速打开 VoxBridge。', 'Keep VoxBridge within easy reach.')}</p>
                </div>
                <input
                  type="checkbox"
                  aria-label={text('创建桌面快捷方式', 'Create desktop shortcut')}
                  checked={shortcut}
                  onChange={(e) => setShortcut(e.target.checked)}
                />
              </div>
              <div className="setup-option">
                <div>
                  <strong>{text('虚拟麦克风', 'Virtual microphone')}</strong>
                  <p>
                    {info?.driver
                      ? text(
                          '已安装 VB-CABLE，保留现有驱动。',
                          'VB-CABLE is installed. Your driver will be kept.',
                        )
                      : info?.upgrade
                        ? text(
                            '本次更新保留驱动状态，可稍后在设置中安装。',
                            'Driver settings stay unchanged. Install later in Settings.',
                          )
                        : text(
                            '可选，用于向 Discord、Oopz、KOOK 发送语音。',
                            'Optional. Send speech to Discord, Oopz or KOOK.',
                          )}
                  </p>
                </div>
                {!info?.driver && !info?.upgrade ? (
                  <input
                    type="checkbox"
                    aria-label={text('安装虚拟麦克风', 'Install virtual microphone')}
                    checked={driver}
                    onChange={(e) => setDriver(e.target.checked)}
                  />
                ) : (
                  <Check className="setup-check" size={18} />
                )}
              </div>
              {driver && (
                <p className="setup-driver-note">
                  {text(
                    'VB-CABLE 由 VB-Audio 提供。安装需要管理员确认，可能需要重启。',
                    'VB-CABLE by VB-Audio. Driver setup needs administrator approval and may require a restart.',
                  )}
                </p>
              )}
            </section>
            <p className="setup-preserve">
              <Check size={15} />
              {text(
                '已有设置、服务配置和密钥都会保留。',
                'Existing settings, service profiles and keys are kept.',
              )}
            </p>
          </>
        ) : busy ? (
          <div className="setup-state">
            <LoaderCircle className="setup-spinner" size={40} />
            <h1>{text('正在安装', 'Installing')}</h1>
            <p>
              {text(
                '正在准备应用文件与快捷方式，请稍候。',
                'Preparing your app and shortcuts. This may take a moment.',
              )}
            </p>
            {driver && (
              <p>
                {text(
                  '如弹出驱动窗口，请完成其中的安装步骤。',
                  'If the driver window opens, complete its installation steps.',
                )}
              </p>
            )}
          </div>
        ) : (
          <div className="setup-state">
            <span className="setup-success">
              <Check size={32} />
            </span>
            <h1>{text('准备好开始了', 'You’re ready to go')}</h1>
            <p>
              {text(
                'VoxBridge 已安装完成，可从开始菜单搜索打开。',
                'VoxBridge is installed. Find it in the Start menu.',
              )}
            </p>
            <p>
              {text(
                '首次使用时，在设置中添加你的模型服务。',
                'For your first session, add your model services in Settings.',
              )}
            </p>
            <label className="setup-open">
              <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
              {text('完成后打开 VoxBridge', 'Open VoxBridge when finished')}
            </label>
            {warning && (
              <p className="setup-error">
                {text(
                  '应用已安装，虚拟麦克风安装未完成。可以稍后在设置中继续。',
                  'The app is installed. Finish virtual microphone setup later in Settings.',
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
            {busy
              ? text('请保持安装器开启', 'Please keep setup open')
              : text('VoxBridge 桌面版', 'VoxBridge Desktop')}
          </span>
          {phase === 'done' ? (
            <button className="primary" onClick={() => void finish()}>
              {text('完成', 'Finish')}
              <ChevronRight size={16} />
            </button>
          ) : (
            <button
              className="primary"
              disabled={busy || !info || choosing || !path}
              onClick={() => void install()}
            >
              {busy
                ? text('安装中…', 'Installing…')
                : text(info?.upgrade ? '更新' : '开始安装', info?.upgrade ? 'Update' : 'Install')}
              <ChevronRight size={16} />
            </button>
          )}
        </footer>
      </main>
    </div>
  );
}
