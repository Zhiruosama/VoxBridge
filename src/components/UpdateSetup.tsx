import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AudioLines, Check, Copy, LoaderCircle, Minus, Square, X } from 'lucide-react';
import { SetupUpdateTask } from '../core/setup-update';
import './Setup.css';

type Result = { restarted: boolean };
const task = new SetupUpdateTask(() => invoke<Result>('setup_update'));

export default function UpdateSetup() {
  const [phase, setPhase] = useState<'preparing' | 'installing' | 'done' | 'error'>('preparing');
  const [english, setEnglish] = useState(false);
  const [version, setVersion] = useState('');
  const [error, setError] = useState('');
  const [maximized, setMaximized] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const text = (zh: string, en: string) => (english ? en : zh);
  const busy = phase === 'preparing' || phase === 'installing';
  useEffect(() => {
    document.documentElement.dataset.theme = 'dark';
    let active = true;
    void Promise.all([invoke<{ language: string }>('setup_inspect'), getVersion()])
      .then(async ([info, next]) => {
        if (!active) return;
        setEnglish(info.language !== 'zh');
        setVersion(next);
        setPhase('installing');
        const installed = await task.run();
        if (active) {
          setResult(installed);
          setPhase('done');
        }
      })
      .catch((e) => {
        if (active) {
          setError(String(e));
          setPhase('error');
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (phase !== 'done' || !result) return;
    const timer = setTimeout(() => {
      void invoke('setup_finish', { open: !result.restarted }).catch(() => {
        setError(
          text(
            '更新已完成，请从开始菜单打开 VoxBridge。',
            'Update complete. Open VoxBridge from the Start menu.',
          ),
        );
      });
    }, 1600);
    return () => clearTimeout(timer);
  }, [phase, result]);
  async function retry() {
    setError('');
    setPhase('installing');
    try {
      setResult(await task.retry());
      setPhase('done');
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  }
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
        <nav aria-label={text('更新进度', 'Update progress')}>
          {[
            text('准备更新', 'Get ready'),
            text('安装更新', 'Install update'),
            text('重新打开', 'Reopen app'),
          ].map((label, index) => {
            const current =
              phase === 'preparing' || phase === 'error' ? 0 : phase === 'installing' ? 1 : 2;
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
        <span className="setup-platform">
          Windows · {version ? `VoxBridge ${version}` : text('软件更新', 'Software update')}
        </span>
      </aside>
      <main className="setup-content">
        <div className="setup-language">
          <button onClick={() => setEnglish(!english)}>{english ? '简体中文' : 'English'}</button>
        </div>
        <div className="setup-state update-setup-state" role="status" aria-live="polite">
          {phase === 'done' ? (
            <span className="setup-success">
              <Check size={32} />
            </span>
          ) : (
            <span className="update-setup-mark">
              {phase === 'error' ? (
                <X size={28} />
              ) : (
                <LoaderCircle className="setup-spinner" size={38} />
              )}
            </span>
          )}
          <h1>
            {phase === 'preparing'
              ? text('正在准备更新', 'Preparing your update')
              : phase === 'installing'
                ? text('正在更新 VoxBridge', 'Updating VoxBridge')
                : phase === 'done'
                  ? text('更新完成', 'Update complete')
                  : text('更新尚未完成', 'Update not completed')}
          </h1>
          {version && <span className="update-setup-version">VoxBridge {version}</span>}
          <p>
            {phase === 'done'
              ? text('即将重新打开，继续使用熟悉的配置。', 'Reopening with your familiar settings.')
              : phase === 'error'
                ? text('请处理下方问题，然后重试。', 'Resolve the issue below, then retry.')
                : text(
                    '正在准备并替换应用文件，请稍候。',
                    'Preparing and replacing app files. Please wait.',
                  )}
          </p>
          {busy && (
            <div
              className="update-setup-progress"
              role="progressbar"
              aria-label={text('正在安装更新', 'Installing update')}
            >
              <span />
            </div>
          )}
          <p className="setup-preserve">
            <Check size={15} />
            {text(
              '设置、服务配置和密钥都会保留。',
              'Your settings, service profiles and keys will be kept.',
            )}
          </p>
          {error && (
            <p className="setup-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="setup-footer">
          <span>
            {busy
              ? text('完成后自动重新打开', 'Reopens automatically when ready')
              : 'VoxBridge Desktop'}
          </span>
          {phase === 'error' && (
            <button className="primary" onClick={() => void retry()}>
              {text('重试更新', 'Retry update')}
            </button>
          )}
        </footer>
      </main>
    </div>
  );
}
