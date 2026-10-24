import { useEffect, useState, type ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ArrowUp, Mic, Square, X } from 'lucide-react';
import { overlayVoiceAction, readOverlayVoice } from '../bridge';
import { newerOverlayVoice, overlayVoiceDefaults, overlayVoiceLabels } from '../core/overlay-voice';
import type { OverlayVoiceRequest, OverlayVoiceState } from '../core/types';
import VoiceActivity from './VoiceActivity';

export default function OverlayVoiceControls({ leading }: { leading?: ReactNode }) {
  const [voice, setVoice] = useState(overlayVoiceDefaults);
  const [ready, setReady] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  useEffect(() => {
    setDraft(voice.draft);
  }, [voice.draft]);
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
    setRequesting(true);
    setError('');
    try {
      await overlayVoiceAction(value);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setRequesting(false);
    }
  }
  const idle = voice.phase === 'idle';
  const recording = voice.phase === 'recording';
  const capturing = ['starting', 'recording', 'recognizing', 'cancelling'].includes(voice.phase);
  const showDraft = idle && Boolean(voice.draft);
  const length = Array.from(draft).length;
  const disabled = !ready || !voice.enabled || requesting;
  return (
    <footer className="overlay-voice-footer" aria-label="悬浮窗语音输入">
      {(error || voice.error) && (
        <div className="overlay-voice-error" role="alert">
          {error || voice.error}
        </div>
      )}
      {showDraft && (
        <textarea
          aria-label="悬浮窗语音草稿"
          value={draft}
          maxLength={6000}
          rows={2}
          placeholder="识别结果可在这里修改…"
          onChange={(event) => setDraft(event.target.value)}
        />
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
              disabled={disabled}
              onClick={() => void request({ action: 'discard' })}
            >
              <X size={15} />
            </button>
            <button
              className="overlay-mic-button"
              aria-label="发送悬浮窗语音"
              title={`生成语音并输出 · ${voice.targetLanguage}`}
              disabled={disabled || !draft.trim() || length > 2000}
              onClick={() => void request({ action: 'send', text: draft })}
            >
              <ArrowUp size={18} />
            </button>
          </>
        )}
        {idle && !showDraft && (
          <button
            className="overlay-mic-button"
            aria-label="悬浮窗开始录音"
            title={
              voice.enabled
                ? `录音并生成语音 · ${voice.targetLanguage} · 最长 1 分钟`
                : '请在主窗口完成设置并返回字幕页'
            }
            disabled={disabled}
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
