import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import SubtitleOverlay from './components/SubtitleOverlay';
import TextTranslationOverlay from './components/TextTranslationOverlay';
import Setup from './components/Setup';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isTauri } from '@tauri-apps/api/core';
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {subtitleWindow ? (
      <SubtitleOverlay />
    ) : textWindow ? (
      <TextTranslationOverlay />
    ) : setupWindow ? (
      <Setup />
    ) : (
      <App />
    )}
    {!subtitleWindow && !textWindow && <StartupReady />}
  </React.StrictMode>,
);
