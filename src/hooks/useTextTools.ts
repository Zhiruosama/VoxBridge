import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { listen } from '@tauri-apps/api/event';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import {
  desktop,
  focusMain,
  hideTextOverlay,
  publishTextOverlay,
  showTextOverlay,
} from '../bridge';
import { ClipboardWatcher } from '../core/clipboard-watch';
import type { TextTranslationController } from '../core/text-translation';
import type { TextOverlayAction } from '../core/text-overlay';
import type { Settings } from '../core/types';
import { profileFor } from '../core/settings';
import { recoveryHint } from '../core/operation-feedback';

/** Kept in the main WebView so hiding the window or changing pages does not stop watching. */
export function useTextTools(
  controller: TextTranslationController,
  settings: Settings,
  onFocus: () => void,
) {
  const [watching, setWatching] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [message, setMessage] = useState('');
  const [copiedText, setCopiedText] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef({ settings, automatic, onFocus });
  current.current = { settings, automatic, onFocus };
  const [watcher] = useState(
    () =>
      new ClipboardWatcher({
        read: readText,
        onStatus: setMessage,
        onText: (text) => {
          clearTimeout(pending.current);
          controller.acceptClipboard(text);
          if (current.current.automatic) {
            const { source, target } = controller.getSnapshot();
            pending.current = setTimeout(() => {
              const now = controller.getSnapshot();
              if (
                now.input === text &&
                now.source === source &&
                now.target === target &&
                current.current.automatic
              )
                void controller.submit(profileFor(current.current.settings, 'translation'));
            }, 350);
          }
        },
      }),
  );
  useEffect(() => {
    if (desktop && watching) watcher.start();
    return () => {
      watcher.stop();
      clearTimeout(pending.current);
    };
  }, [watcher, watching]);
  useEffect(() => {
    clearTimeout(pending.current);
  }, [automatic]);
  function changeWatching(value: boolean) {
    setWatching(value);
    setMessage('');
    if (!value) {
      watcher.stop();
      clearTimeout(pending.current);
      current.current.automatic = false;
      setAutomatic(false);
    }
  }
  function changeAutomatic(value: boolean) {
    clearTimeout(pending.current);
    current.current.automatic = value;
    setAutomatic(value);
  }
  async function copy(text: string) {
    watcher.ignoreCopy(text);
    setCopyFailed(false);
    setCopiedText('');
    try {
      if (desktop) await writeText(text);
      else await navigator.clipboard.writeText(text);
      setCopiedText(text);
    } catch (error) {
      watcher.forgetCopy(text);
      setCopyFailed(true);
      throw error;
    }
  }
  function translate() {
    clearTimeout(pending.current);
    void controller.submit(profileFor(current.current.settings, 'translation'));
  }
  const actions = useRef<(request: TextOverlayAction) => void>(() => {});
  actions.current = (request) => {
    if (request.action === 'translate') translate();
    else if (request.action === 'copy')
      void copy(request.text).catch(() => setMessage('复制失败，请手动选择译文复制。'));
    else if (request.action === 'pause') changeWatching(false);
    else {
      current.current.onFocus();
      void focusMain()
        .then(hideTextOverlay)
        .catch(() => setMessage('无法返回主窗口。'));
    }
  };
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void listen<TextOverlayAction>('text-overlay-request', (event) =>
      actions.current(event.payload),
    )
      .then((unlisten) => {
        if (disposed) unlisten();
        else cleanup = unlisten;
      })
      .catch(() => setMessage('文本浮窗同步失败，请重试。'));
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
  useEffect(() => {
    function ownSelection() {
      const selection = window.getSelection();
      if (selection?.anchorNode?.parentElement?.closest('.text-translation-result')) {
        const text = selection.toString();
        if (text) watcher.ignoreCopy(text);
      }
    }
    document.addEventListener('copy', ownSelection);
    return () => document.removeEventListener('copy', ownSelection);
  }, [watcher]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const version = useRef(Date.now());
  const canTranslate = !!state.input.trim() && [...state.input].length <= 2000 && !state.busy;
  useEffect(() => {
    if (!desktop) return;
    void publishTextOverlay({
      version: ++version.current,
      appearance: settings.textOverlay,
      uiLanguage: settings.uiLanguage,
      result: [...state.result].slice(0, 12000).join(''),
      target: state.resultTarget || state.target,
      busy: state.busy,
      error: state.error ? recoveryHint(state.error).slice(0, 400) : '',
      canTranslate,
      watching,
      automatic,
      copied: !!state.result && state.result === copiedText,
      copyError: copyFailed,
    }).catch(() => setMessage('文本浮窗同步失败，请重试。'));
  }, [
    state.result,
    state.resultTarget,
    state.target,
    state.busy,
    state.error,
    canTranslate,
    settings.uiLanguage,
    settings.textOverlay,
    watching,
    automatic,
    copiedText,
    copyFailed,
  ]);
  async function openOverlay() {
    try {
      await showTextOverlay();
      setMessage('');
    } catch {
      setMessage('无法打开文本浮窗，请重试。');
    }
  }
  return {
    watching,
    automatic,
    message,
    changeWatching,
    setAutomatic: changeAutomatic,
    copy,
    openOverlay,
    available: desktop,
    translate,
  };
}
export type TextTools = ReturnType<typeof useTextTools>;
