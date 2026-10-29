import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import SubtitleOverlay from './components/SubtitleOverlay';
import TextTranslationOverlay from './components/TextTranslationOverlay';
import Setup from './components/Setup';
import Uninstall from './components/Uninstall';
import UpdateSetup from './components/UpdateSetup';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { bootstrapPrivatePreset } from './core/private-preset';
import '@fontsource-variable/noto-sans-sc';
import './styles.css';

const subtitleWindow = isTauri() && getCurrentWebviewWindow().label === 'subtitle';
const textWindow = isTauri() && getCurrentWebviewWindow().label === 'text-overlay';
const setupWindow = isTauri() && getCurrentWebviewWindow().label === 'setup';
if (subtitleWindow || textWindow) document.documentElement.dataset.overlay = 'true';

function StartupReady() {
  React.useLayoutEffect(() => {
    window.dispatchEvent(new Event('voxbridge:ready'));
  }, []);
  return null;
}

async function start() {
  let bootstrapError = '';
  if (isTauri() && !subtitleWindow && !textWindow && !setupWindow) {
    try {
      await bootstrapPrivatePreset((install) => invoke('private_preset', { install }));
    } catch {
      bootstrapError = '体验配置导入失败，原有设置与密钥未覆盖，请重启重试。';
    }
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {subtitleWindow ? (
        <SubtitleOverlay />
      ) : textWindow ? (
        <TextTranslationOverlay />
      ) : setupWindow ? (
        new URLSearchParams(location.search).get('mode') === 'uninstall' ? (
          <Uninstall />
        ) : new URLSearchParams(location.search).get('mode') === 'update' ? (
          <UpdateSetup />
        ) : (
          <Setup />
        )
      ) : (
        <App bootstrapError={bootstrapError} />
      )}
      {!subtitleWindow && !textWindow && <StartupReady />}
    </React.StrictMode>,
  );
}
void start();
