import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import SubtitleOverlay from './components/SubtitleOverlay';
import Setup from './components/Setup';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isTauri } from '@tauri-apps/api/core';
import '@fontsource-variable/noto-sans-sc';
import './styles.css';

const subtitleWindow = isTauri() && getCurrentWebviewWindow().label === 'subtitle';
const setupWindow = isTauri() && getCurrentWebviewWindow().label === 'setup';
if (subtitleWindow) document.documentElement.dataset.overlay = 'true';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {subtitleWindow ? <SubtitleOverlay /> : setupWindow ? <Setup /> : <App />}
  </React.StrictMode>,
);
