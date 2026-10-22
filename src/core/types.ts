export type Stage = 'asr' | 'translation' | 'tts';
export type Adapter = 'openai_chat_completions' | 'minimax_tts_ws' | 'pending_asr';
export interface ProviderProfile {
  id: string;
  name: string;
  stage: Stage;
  adapter: Adapter;
  baseUrl: string;
  modelId: string;
  voice: string;
}
export interface Settings {
  schemaVersion: 1;
  profiles: ProviderProfile[];
  active: Record<Stage, string>;
  sourceLanguage: string;
  targetLanguage: string;
  theme: 'dark' | 'light' | 'system';
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
