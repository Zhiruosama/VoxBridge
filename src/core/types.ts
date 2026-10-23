export type Stage = 'asr' | 'translation' | 'tts';
export type Adapter =
  | 'openai_chat_completions'
  | 'minimax_tts_ws'
  | 'openai_audio_speech'
  | 'qwen_chat_asr'
  | 'qwen_dashscope_asr'
  | 'pending_asr';
export interface AudioRouting {
  previewDeviceId: string;
  sendDeviceId: string;
  monitorEnabled?: boolean;
}
export interface SpeechProgress {
  requestId: string;
  phase:
    | 'monitorUnavailable'
    | 'waitingDevice'
    | 'synthesizing'
    | 'decoding'
    | 'playing'
    | 'completed'
    | 'stopped'
    | 'failed';
}
export interface ProviderProfile {
  id: string;
  name: string;
  stage: Stage;
  adapter: Adapter;
  baseUrl: string;
  modelId: string;
  voice: string;
  thinking?: 'enabled' | 'disabled';
  translationPrompt?: string;
}
export interface SubtitleAppearance {
  fontSize: number;
  backgroundOpacity: number;
  mode: 'compact' | 'continuous';
  content: 'translation' | 'bilingual' | 'source';
  textColor: string;
  lineHeight: number;
}
export interface OverlaySnapshot extends SubtitleAppearance {
  version: number;
  sessionId: string | null;
  phase: 'idle' | 'starting' | 'running' | 'recovering' | 'stopping';
  lines: {
    segmentId: string;
    revision: number;
    final: boolean;
    translationState: 'pending' | 'ready' | 'failed';
    source: string;
    translation?: string;
    time: string;
  }[];
}
export interface ComposerSettings {
  enterAction: 'speak' | 'translate' | 'newline';
  output: 'source' | 'translation';
  route: 'preview' | 'send';
}
export interface Settings {
  schemaVersion: 1;
  profiles: ProviderProfile[];
  active: Record<Stage, string>;
  sourceLanguage: string;
  targetLanguage: string;
  theme: 'dark' | 'light' | 'system';
  captionColors: { recognition: string; expression: string };
  audio: AudioRouting;
  subtitle: SubtitleAppearance;
  composer: ComposerSettings;
  listening: { sourceLanguage: string; targetLanguage: string };
}
export interface Segment {
  id: string;
  revision: number;
  source: string;
  translation?: string;
  translationRevision?: number;
  translationError?: boolean;
  final: boolean;
  time: string;
}
export interface TranscriptEvent {
  sessionId: string;
  segmentId: string;
  revision: number;
  text: string;
  final: boolean;
  startMs?: number;
}
export interface Session {
  id: string | null;
  segments: Segment[];
}
export interface RuntimeInfo {
  platform: string;
  nativeCapture: boolean;
  message: string;
}
export interface OutputDevice {
  id: string;
  name: string;
}
export interface Transcript {
  text: string;
  audioSeconds: number;
}
export interface CaptureSource {
  pid: number;
  bundleId: string;
  name?: string;
  appScoped?: boolean;
}
export interface RecognitionMetrics {
  firstPartialMs: number | null;
  firstFinalMs: number | null;
  providerFinals: number;
  committedCaptions: number;
  finalizationSamples: number;
  commitSamples: number;
  partialToFinalP50Ms: number;
  partialToFinalP95Ms: number;
  commitHoldP50Ms: number;
  commitHoldP95Ms: number;
}
export interface TranslationMetrics {
  completed: number;
  failed: number;
  sampleCount: number;
  queued: number;
  inflight: number;
  queueP50Ms: number;
  queueP95Ms: number;
  requestP50Ms: number;
  requestP95Ms: number;
  totalP50Ms: number;
  totalP95Ms: number;
}
export type ListeningEvent =
  | {
      type: 'recognitionMetrics';
      sessionId: string;
      generation: number;
      metrics: RecognitionMetrics;
    }
  | {
      type: 'translationMetrics';
      sessionId: string;
      generation: number;
      metrics: TranslationMetrics;
    }
  | {
      type: 'translationError';
      sessionId: string;
      generation: number;
      segmentId: string;
      revision: number;
    }
  | { type: 'recovering'; sessionId: string; attempt: number; delayMs: number; reason: string }
  | { type: 'sourceChanged'; sessionId: string; generation: number; source: CaptureSource }
  | {
      type: 'progress';
      generation?: number;
      sessionId: string;
      phase: 'starting' | 'running' | 'stopped' | 'failed';
      sampleRate: number;
      frames: number;
      rms: number;
      droppedFrames: number;
      droppedSegments: number;
      discontinuities: number;
    }
  | (TranscriptEvent & { type: 'transcript'; startMs: number; generation?: number })
  | {
      type: 'translation';
      generation?: number;
      sessionId: string;
      segmentId: string;
      revision: number;
      text: string;
      sourceText?: string;
    };
export interface CaptureProgress {
  sessionId: string;
  phase: 'starting' | 'running' | 'stopped' | 'failed';
  sampleRate: number;
  frames: number;
  droppedFrames: number;
  rms: number;
}
