export type Stage = 'asr' | 'translation' | 'tts';
export type Adapter =
  | 'openai_chat_completions'
  | 'minimax_tts_ws'
  | 'openai_audio_speech'
  | 'qwen_chat_asr'
  | 'pending_asr';
export interface AudioRouting {
  previewDeviceId: string;
  sendDeviceId: string;
}
export interface SpeechProgress {
  requestId: string;
  phase: 'synthesizing' | 'decoding' | 'playing' | 'completed' | 'stopped' | 'failed';
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
}
export interface Settings {
  schemaVersion: 1;
  profiles: ProviderProfile[];
  active: Record<Stage, string>;
  sourceLanguage: string;
  targetLanguage: string;
  theme: 'dark' | 'light' | 'system';
  audio: AudioRouting;
}
export interface Segment {
  id: string;
  revision: number;
  source: string;
  translation?: string;
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
}
export type ListeningEvent =
  | {
      type: 'progress';
      sessionId: string;
      phase: 'starting' | 'running' | 'stopped' | 'failed';
      sampleRate: number;
      rms: number;
      droppedFrames: number;
      droppedSegments: number;
      discontinuities: number;
    }
  | (TranscriptEvent & { type: 'transcript'; startMs: number })
  | { type: 'translation'; sessionId: string; segmentId: string; revision: number; text: string };
export interface CaptureProgress {
  sessionId: string;
  phase: 'starting' | 'running' | 'stopped' | 'failed';
  sampleRate: number;
  frames: number;
  droppedFrames: number;
  rms: number;
}
