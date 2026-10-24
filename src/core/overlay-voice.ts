import type { OverlayVoiceState } from './types';
export const overlayVoiceDefaults: OverlayVoiceState = {
  version: 0,
  phase: 'idle',
  level: 0,
  mode: 'dictate',
  enabled: false,
  targetLanguage: '英语',
  speed: 1,
  queue: { paused: false, items: [] },
  error: '',
  draft: '',
};
export function newerOverlayVoice(current: OverlayVoiceState, next: OverlayVoiceState) {
  return next.version > current.version ? next : current;
}
export const overlayVoiceLabels: Record<OverlayVoiceState['phase'], string> = {
  idle: '',
  starting: '准备录音…',
  recording: '正在聆听',
  recognizing: '识别中…',
  cancelling: '取消中…',
  waitingDevice: '等待设备…',
  detecting: '处理中…',
  translating: '翻译中…',
  synthesizing: '合成中…',
  decoding: '准备播放…',
  playing: '输出中…',
  stopping: '停止中…',
};

// A delayed send acknowledgement must not replace the user's next message.
export function reconcileOverlayDraft(
  local: string,
  previous: string,
  next: string,
  sent: string | null,
) {
  if (sent !== null && (next === sent || (!next && previous === sent))) return local;
  return next || (local === previous ? '' : local);
}

export function restoreOverlayDraft(
  local: string,
  revision: number,
  submitted: { text: string; revision: number },
) {
  return revision === submitted.revision ? submitted.text : local;
}
