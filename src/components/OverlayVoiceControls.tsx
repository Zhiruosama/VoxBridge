import { t } from '../i18n';
import SendQueueControls from './SendQueueControls';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { listen } from '@tauri-apps/api/event';
import { ArrowUp, Keyboard, LoaderCircle, Mic, Square, X } from 'lucide-react';
import { overlayVoiceAction, readOverlayVoice, setOverlayTextInput } from '../bridge';
import {
  newerOverlayVoice,
  overlayVoiceDefaults,
  overlayVoiceLabels,
  reconcileOverlayDraft,
  restoreOverlayDraft,
  acknowledgeOverlayDraft,
} from '../core/overlay-voice';
import { composerKeyAction } from '../core/composer';
import { recordDiagnostic } from '../diagnostics';
import type { OverlayVoiceRequest, OverlayVoiceState } from '../core/types';
import VoiceActivity from './VoiceActivity';
import SpeechSpeedPicker from './SpeechSpeedPicker';

export default function OverlayVoiceControls({
  leading,
  editorContainer,
}: {
  leading?: ReactNode;
  editorContainer: HTMLElement | null;
}) {
  const [voice, setVoice] = useState(overlayVoiceDefaults);
  const [ready, setReady] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [textOpen, setTextOpen] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const remoteDraftRef = useRef('');
  const sentRef = useRef<string | null>(null);
  const draftRevision = useRef(0);
  const submittedRef = useRef<{ id: string; text: string; revision: number } | null>(null);
  useEffect(() => {
    const previous = remoteDraftRef.current;
    remoteDraftRef.current = voice.draft;
    // Preserve a new local edit when the main window clears the completed message.
    const sent = sentRef.current;
    setDraft((current) => reconcileOverlayDraft(current, previous, voice.draft, sent));
    if (!voice.draft && previous === sent) {
      sentRef.current = null;
    }
  }, [voice.draft]);
  function restoreSubmitted() {
    const submitted = submittedRef.current;
    if (submitted)
      setDraft((current) => restoreOverlayDraft(current, draftRevision.current, submitted));
  }
  useEffect(() => {
    const submitted = submittedRef.current;
    const acknowledgement = voice.submission;
    if (!submitted || acknowledgement?.id !== submitted.id) return;
    setDraft((current) =>
      acknowledgeOverlayDraft(current, draftRevision.current, submitted, acknowledgement.accepted),
    );
    setError(acknowledgement.accepted ? '' : acknowledgement.error);
    submittedRef.current = null;
    setSending(false);
  }, [voice.submission]);
  useEffect(() => {
    if (!sending && !textOpen) return;
    // Read back acknowledgements as well as subscribing: a hidden WebView may
    // miss an event while AppKit transfers it between input/display panels.
    const timer = setInterval(() => {
      void readOverlayVoice()
        .then((state) => {
          setVoice((current) => newerOverlayVoice(current, state));
          setReady(true);
        })
        .catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [sending, textOpen]);
  useEffect(() => {
    if (!textOpen) return;
    let active = true;
    void setOverlayTextInput(true)
      .then(() => {
        if (active) editorRef.current?.focus();
      })
      .catch(() => {
        if (active) setError('无法准备悬浮窗输入法，请收起输入框后重试。');
      });
    return () => {
      active = false;
      void setOverlayTextInput(false).catch(() => {});
    };
  }, [textOpen]);
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const unlisten = await listen<OverlayVoiceState>('overlay-voice-state', (event) => {
        if (!disposed) setVoice((current) => newerOverlayVoice(current, event.payload));
      });
      if (disposed) {
        unlisten();
        return;
      }
      unsubscribe = unlisten;
      const initial = await readOverlayVoice();
      if (!disposed) {
        setVoice((current) => newerOverlayVoice(current, initial));
        setReady(true);
      }
    })().catch(() => {
      if (!disposed) setError('语音入口未连接，请重新打开悬浮窗或重启软件。');
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);
  async function request(value: OverlayVoiceRequest) {
    if (value.action === 'send') {
      if (submittedRef.current) return;
      const id = crypto.randomUUID();
      value = { ...value, requestId: id };
      sentRef.current = value.text;
      submittedRef.current = { id, text: value.text, revision: draftRevision.current };
      setSending(true);
      editorRef.current?.focus();
    }
    setRequesting(true);
    setError('');
    try {
      await overlayVoiceAction(value);
    } catch (failure) {
      if (value.action === 'send') {
        restoreSubmitted();
        sentRef.current = null;
        submittedRef.current = null;
        setSending(false);
      }
      setError(String(failure));
    } finally {
      setRequesting(false);
    }
  }
  const idle = voice.phase === 'idle';
  const recording = voice.phase === 'recording';
  const capturing = ['starting', 'recording', 'recognizing', 'cancelling'].includes(voice.phase);
  const showDraft = textOpen;
  const length = Array.from(draft).length;
  const disabled = !ready || !voice.enabled || requesting || sending;
  return (
    <footer className="overlay-voice-footer" aria-label={t('悬浮窗语音输入')}>
      {(error || voice.error) && (
        <div className="overlay-voice-error" role="alert">
          {t(error || voice.error)}
        </div>
      )}
      {showDraft &&
        editorContainer &&
        createPortal(
          <div className="overlay-text-panel">
            <textarea
              id="overlay-text-input"
              ref={editorRef}
              aria-label={t('悬浮窗输入内容')}
              value={draft}
              maxLength={2000}
              rows={2}
              placeholder={t('输入要说的话…')}
              onFocus={() =>
                void setOverlayTextInput(true).catch(() =>
                  setError('无法准备悬浮窗输入法，请收起输入框后重试。'),
                )
              }
              onChange={(event) => {
                draftRevision.current++;
                setDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                // AppKit can move this WKWebView between panels while composing.
                // A cached compositionstart flag can then outlive compositionend.
                // Use the current key event (including WebKit's 229 IME marker).
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
                  if (event.key === 'Enter')
                    recordDiagnostic({
                      operation: 'frontend',
                      kind: 'state',
                      phase: 'overlay_enter_composing',
                    });
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setTextOpen(false);
                } else if (
                  event.key === 'Enter' &&
                  composerKeyAction(event.nativeEvent, 'speak') !== 'newline'
                ) {
                  event.preventDefault();
                  if (event.repeat) return;
                  const text = event.currentTarget.value;
                  const phase = !ready
                    ? 'overlay_enter_not_ready'
                    : !voice.enabled
                      ? 'overlay_enter_disabled'
                      : sending
                        ? 'overlay_enter_pending'
                        : requesting || capturing
                          ? 'overlay_enter_busy'
                          : !text.trim() || Array.from(text).length > 2000
                            ? 'overlay_enter_empty'
                            : 'overlay_enter_send';
                  recordDiagnostic({ operation: 'frontend', kind: 'state', phase });
                  if (phase === 'overlay_enter_send') void request({ action: 'send', text });
                }
              }}
            />
          </div>,
          editorContainer,
        )}
      <div className="overlay-voice-actions">
        {leading}
        <SendQueueControls view={voice.queue} onAction={(action) => void request(action)} />
        <SpeechSpeedPicker
          value={voice.speed}
          disabled={!ready || !voice.enabled}
          onChange={(speed) => void request({ action: 'speed', speed })}
        />
        {recording ? (
          <VoiceActivity phase="recording" level={voice.level} />
        ) : (
          !idle && (
            <span className="overlay-voice-phase" role="status">
              {t(overlayVoiceLabels[voice.phase])}
            </span>
          )
        )}
        {showDraft && (
          <>
            {length > 1800 && <span className="overlay-voice-count">{length}/2000</span>}
            <button
              type="button"
              aria-label={t('关闭悬浮窗输入框')}
              aria-description={t('收起输入框，保留草稿')}
              aria-controls="overlay-text-input"
              onClick={() => {
                setTextOpen(false);
                editorRef.current?.blur();
              }}
            >
              <X size={15} />
            </button>
            <button
              className="overlay-mic-button"
              aria-label={t('发送悬浮窗语音')}
              aria-description={t('生成语音并输出 · {0}', t(voice.targetLanguage))}
              disabled={disabled || capturing || !draft.trim() || length > 2000}
              onClick={() =>
                void request({ action: 'send', text: editorRef.current?.value ?? draft })
              }
            >
              {sending ? (
                <LoaderCircle size={18} className="status-spinner" />
              ) : (
                <ArrowUp size={18} />
              )}
            </button>
          </>
        )}
        <button
          className="overlay-text-button"
          aria-label={t(showDraft ? '收起悬浮窗输入框' : '打开悬浮窗输入框')}
          aria-description={t(showDraft ? '收起输入框' : '打字输入')}
          aria-expanded={showDraft}
          aria-controls="overlay-text-input"
          onClick={() => {
            if (showDraft) {
              setTextOpen(false);
              // Keep unsent text when collapsing the editor.
              editorRef.current?.blur();
            } else setTextOpen(true);
          }}
        >
          <Keyboard size={18} />
        </button>
        {idle && (
          <button
            className="overlay-mic-button"
            aria-label={t('悬浮窗开始录音')}
            aria-description={t(
              voice.enabled
                ? t('录音并生成语音 · {0} · 最长 1 分钟', t(voice.targetLanguage))
                : '请在主窗口完成设置并返回字幕页',
            )}
            disabled={disabled || Boolean(draft.trim()) || Boolean(voice.draft.trim())}
            onClick={() => void request({ action: 'start' })}
          >
            <Mic size={18} />
          </button>
        )}
        {capturing && (
          <>
            <button
              className="overlay-voice-cancel"
              aria-label={t('取消悬浮窗录音')}
              aria-description={t('取消录音')}
              disabled={requesting || voice.phase === 'cancelling'}
              onClick={() => void request({ action: 'cancel' })}
            >
              <X size={15} />
            </button>
            {recording && (
              <button
                className="overlay-mic-button is-recording"
                aria-label={t('悬浮窗结束录音')}
                aria-description={t(
                  voice.mode === 'send' ? '结束录音并发送语音' : '结束录音，先确认文字',
                )}
                disabled={requesting}
                onClick={() => void request({ action: 'finish' })}
              >
                <Square size={15} />
              </button>
            )}
          </>
        )}
        {!idle && !capturing && (
          <button
            className="overlay-mic-button"
            aria-label={t('停止悬浮窗语音输出')}
            aria-description={t('停止当前操作')}
            disabled={requesting || voice.phase === 'stopping'}
            onClick={() => void request({ action: 'stop' })}
          >
            <Square size={15} />
          </button>
        )}
      </div>
    </footer>
  );
}
