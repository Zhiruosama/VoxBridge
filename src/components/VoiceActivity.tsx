import { t } from '../i18n';
import type { CSSProperties } from 'react';

export default function VoiceActivity({
  phase,
  level,
}: {
  phase: 'starting' | 'recording' | 'recognizing' | 'cancelling';
  level: number;
}) {
  const recording = phase === 'recording';
  const label = recording
    ? '正在聆听'
    : phase === 'starting'
      ? '准备录音…'
      : phase === 'cancelling'
        ? '取消中…'
        : '识别中…';
  const strength = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  return (
    <div
      className={`voice-activity ${recording ? 'is-recording' : 'is-processing'}`}
      aria-label={t(label)}
    >
      <span
        className="voice-wave"
        aria-hidden="true"
        style={{ '--voice-level': strength } as CSSProperties}
      >
        {[0, 1, 2, 3, 4, 5, 6].map((index) => (
          <i key={index} style={{ '--bar-delay': `${index * -0.13}s` } as CSSProperties} />
        ))}
      </span>
      <span>{t(label)}</span>
    </div>
  );
}
