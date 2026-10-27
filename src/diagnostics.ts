import type { ListeningEvent, SpeechProgress } from './core/types';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { errorKind, correlationId, adapterCode, type DiagnosticEvent } from './core/diagnostics';

const commands = new Set([
  'detect_text_language',
  'credential_status',
  'set_credential',
  'remove_credential',
  'translate',
  'cancel_translation',
  'list_outputs',
  'test_tone',
  'stop_tone',
  'speak',
  'stop_speech',
  'list_capture_sources',
  'capture_diagnostic',
  'stop_capture',
  'finish_listening',
  'transcribe_wav',
  'stop_asr',
  'start_listening',
  'show_overlay',
  'hide_overlay',
  'focus_main',
  'stop_overlay_listening',
  'set_speech_monitoring',
  'open_virtual_mic_installer',
  'virtual_mic_status',
  'open_virtual_mic_vendor',
  'list_inputs',
  'start_voice_input',
  'finish_voice_input',
  'cancel_voice_input',
  'prepare_speech',
  'play_prepared_speech',
  'discard_prepared_speech',
]);
export function recordDiagnostic(event: DiagnosticEvent) {
  if (!isTauri()) return;
  // Never forward an error message, payload, settings object or arbitrary metadata.
  void invoke('record_diagnostic', { event }).catch(() => {});
}
export async function diagnosticInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri() || !commands.has(command)) return invoke<T>(command, args);
  const started = performance.now();
  const traceId = crypto.randomUUID();
  const request = args?.request as
    | { sessionId?: unknown; asrProfile?: { adapter?: unknown } }
    | undefined;
  const profile = (args?.profile ?? request?.asrProfile) as { adapter?: unknown } | undefined;
  const adapter = adapterCode(profile?.adapter);
  const correlation = correlationId(args?.requestId ?? args?.sessionId ?? request?.sessionId);
  const base = {
    operation: command,
    traceId,
    ...(adapter ? { adapter } : {}),
    ...(correlation ? { correlationId: correlation } : {}),
  };
  recordDiagnostic({ ...base, kind: 'start' });
  try {
    const result = await invoke<T>(command, args);
    recordDiagnostic({
      ...base,
      kind: 'finish',
      durationMs: Math.min(86_400_000, Math.round(performance.now() - started)),
    });
    return result;
  } catch (error) {
    recordDiagnostic({
      ...base,
      kind: 'error',
      durationMs: Math.min(86_400_000, Math.round(performance.now() - started)),
      reason: errorKind(error),
    });
    throw error;
  }
}
export function watchFrontendErrors() {
  const error = (event: ErrorEvent) =>
    recordDiagnostic({
      operation: 'frontend',
      kind: 'error',
      phase: 'unhandled_error',
      reason: errorKind(event.error),
    });
  const rejection = (event: PromiseRejectionEvent) =>
    recordDiagnostic({
      operation: 'frontend',
      kind: 'error',
      phase: 'unhandled_rejection',
      reason: errorKind(event.reason),
    });
  window.addEventListener('error', error);
  window.addEventListener('unhandledrejection', rejection);
  return () => {
    window.removeEventListener('error', error);
    window.removeEventListener('unhandledrejection', rejection);
  };
}
export function openDiagnosticsFolder(): Promise<void> {
  return invoke('open_diagnostics_folder');
}
export function exportDiagnostics(): Promise<void> {
  return invoke('export_diagnostics');
}

export function diagnosticSpeechProgress(
  operation: string,
  requestId: string,
  callback: (event: SpeechProgress) => void,
) {
  const started = performance.now();
  let previous = '';
  return (event: SpeechProgress) => {
    if (event.requestId === requestId && event.phase !== previous) {
      recordDiagnostic({
        operation,
        kind: 'state',
        correlationId: correlationId(requestId),
        phase: event.phase,
        durationMs: Math.min(86_400_000, Math.round(performance.now() - started)),
      });
      previous = event.phase;
    }
    callback(event);
  };
}
export function diagnosticListeningProgress(callback: (event: ListeningEvent) => void) {
  const reports = new Map<string, number>();
  return (event: ListeningEvent) => {
    const correlation = correlationId(event.sessionId);
    const attempt = 'generation' in event ? event.generation : undefined;
    if (event.type === 'translationError')
      recordDiagnostic({
        operation: 'translate',
        kind: 'error',
        correlationId: correlation,
        attempt,
        reason: 'invalid_response',
      });
    if (
      event.type === 'progress' &&
      event.audioQuality &&
      performance.now() - (reports.get('audio_quality') ?? -Infinity) >= 5000
    ) {
      reports.set('audio_quality', performance.now());
      recordDiagnostic({
        operation: 'start_listening',
        kind: 'state',
        correlationId: correlation,
        attempt,
        phase: 'audio_quality',
        count: Math.min(1_000_000_000, event.audioQuality.nearPeakFrames),
        failedCount: Math.min(1_000_000_000, event.audioQuality.lowDownmixWindows),
      });
    }
    if (event.type === 'sourceChanged')
      recordDiagnostic({
        operation: 'start_listening',
        kind: 'state',
        correlationId: correlation,
        attempt,
        phase: 'source_changed',
      });
    if (
      (event.type === 'recognitionMetrics' || event.type === 'translationMetrics') &&
      performance.now() - (reports.get(event.type) ?? -Infinity) >= 5000
    ) {
      reports.set(event.type, performance.now());
      if (event.type === 'recognitionMetrics') {
        recordDiagnostic({
          operation: 'start_listening',
          kind: 'state',
          correlationId: correlation,
          attempt,
          phase: 'recognition_metrics',
          count: Math.min(1_000_000_000, event.metrics.committedCaptions),
          durationMs: Math.min(86_400_000, event.metrics.partialToFinalP95Ms),
        });
        recordDiagnostic({
          operation: 'start_listening',
          kind: 'state',
          correlationId: correlation,
          attempt,
          phase: 'recognition_corrections',
          count: Math.min(1_000_000_000, event.metrics.correctedCaptions ?? 0),
          failedCount: Math.min(1_000_000_000, event.metrics.finalDisagreements ?? 0),
        });
      } else
        recordDiagnostic({
          operation: 'translate',
          kind: 'state',
          correlationId: correlation,
          attempt,
          phase: 'translation_metrics',
          count: Math.min(1_000_000_000, event.metrics.completed),
          failedCount: Math.min(1_000_000_000, event.metrics.failed),
          queued: event.metrics.queued,
          inflight: event.metrics.inflight,
          durationMs: Math.min(86_400_000, event.metrics.totalP95Ms),
        });
    }
    callback(event);
  };
}
