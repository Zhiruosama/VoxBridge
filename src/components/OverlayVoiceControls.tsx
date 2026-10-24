import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { listen } from '@tauri-apps/api/event';
import { ArrowUp, Keyboard, Mic, Square, X } from 'lucide-react';
import { overlayVoiceAction, readOverlayVoice } from '../bridge';
import {
  newerOverlayVoice,
  overlayVoiceDefaults,
  overlayVoiceLabels,
  reconcileOverlayDraft,
} from '../core/overlay-voice';
import type { OverlayVoiceRequest, OverlayVoiceState } from '../core/types';
import VoiceActivity from './VoiceActivity';

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
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [textOpen, setTextOpen] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const remoteDraftRef = useRef('');
  const sentRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = remoteDraftRef.current;
    remoteDraftRef.current = voice.draft;
    // Preserve a new local edit when the main window clears the completed message.
    const sent = sentRef.current;
    setDraft((current) => reconcileOverlayDraft(current, previous, voice.draft, sent));
    if (!voice.draft) sentRef.current = null;
  }, [voice.draft]);
  useEffect(() => {
    if (textOpen) editorRef.current?.focus();
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
    if (value.action === 'send') sentRef.current = value.text;
    setRequesting(true);
    setError('');
    try {
      await overlayVoiceAction(value);
    } catch (failure) {
      if (value.action === 'send') sentRef.current = null;
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
  const disabled = !ready || !voice.enabled || requesting;
  return (
    <footer className="overlay-voice-footer" aria-label="悬浮窗语音输入">
      {(error || voice.error) && (
        <div className="overlay-voice-error" role="alert">
          {error || voice.error}
        </div>
      )}
      {showDraft &&
        editorContainer &&
        createPortal(
          <div className="overlay-text-panel">
            <textarea
              id="overlay-text-input"
              ref={editorRef}
              aria-label="悬浮窗输入内容"
              value={draft}
              maxLength={2000}
              rows={2}
              placeholder="输入要说的话…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setTextOpen(false);
                } else if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229
                ) {
                  event.preventDefault();
                  if (idle && !disabled && draft.trim() && length <= 2000)
                    void request({ action: 'send', text: draft });
                }
              }}
            />
          </div>,
          editorContainer,
        )}
      <div className="overlay-voice-actions">
        {leading}
        {recording ? (
          <VoiceActivity phase="recording" level={voice.level} />
        ) : (
          !idle && (
            <span className="overlay-voice-phase" role="status">
              {overlayVoiceLabels[voice.phase]}
            </span>
          )
        )}
        {showDraft && (
          <>
            {length > 1800 && <span className="overlay-voice-count">{length}/2000</span>}
            <button
              aria-label="清空悬浮窗语音草稿"
              title="清空草稿"
              disabled={disabled || !idle}
              onClick={() => {
                setDraft('');
                void request({ action: 'discard' });
              }}
            >
              <X size={15} />
            </button>
            <button
              className="overlay-mic-button"
              aria-label="发送悬浮窗语音"
              title={`生成语音并输出 · ${voice.targetLanguage}`}
              disabled={disabled || !idle || !draft.trim() || length > 2000}
              onClick={() => void request({ action: 'send', text: draft })}
            >
              <ArrowUp size={18} />
            </button>
          </>
        )}
        <button
          className="overlay-text-button"
          aria-label={showDraft ? '收起悬浮窗输入框' : '打开悬浮窗输入框'}
          title={showDraft ? '收起输入框' : '打字输入'}
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
            aria-label="悬浮窗开始录音"
            title={
              voice.enabled
                ? `录音并生成语音 · ${voice.targetLanguage} · 最长 1 分钟`
                : '请在主窗口完成设置并返回字幕页'
            }
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
              aria-label="取消悬浮窗录音"
              title="取消录音"
              disabled={requesting || voice.phase === 'cancelling'}
              onClick={() => void request({ action: 'cancel' })}
            >
              <X size={15} />
            </button>
            {recording && (
              <button
                className="overlay-mic-button is-recording"
                aria-label="悬浮窗结束录音"
                title={voice.mode === 'send' ? '结束录音并发送语音' : '结束录音，先确认文字'}
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
            aria-label="停止悬浮窗语音输出"
            title="停止当前操作"
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
