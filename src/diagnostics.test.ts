import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mock.invoke, isTauri: () => true }));
import {
  diagnosticInvoke,
  diagnosticListeningProgress,
  diagnosticSpeechProgress,
} from './diagnostics';
import { correlationId, errorKind } from './core/diagnostics';
beforeEach(() => mock.invoke.mockReset());
describe('local diagnostic boundaries', () => {
  it('samples listening metrics and deduplicates speech stages without copying event content', () => {
    mock.invoke.mockResolvedValue(undefined);
    const callback = vi.fn();
    const listener = diagnosticListeningProgress(callback);
    const sessionId = '11111111-2222-4333-8444-555555555555';
    const metric = {
      type: 'recognitionMetrics' as const,
      sessionId,
      generation: 0,
      metrics: {
        firstPartialMs: 100,
        firstFinalMs: 200,
        providerFinals: 1,
        committedCaptions: 1,
        finalizationSamples: 1,
        commitSamples: 1,
        partialToFinalP50Ms: 100,
        partialToFinalP95Ms: 100,
        commitHoldP50Ms: 20,
        commitHoldP95Ms: 20,
      },
    };
    listener(metric);
    listener(metric);
    listener({
      type: 'transcript',
      sessionId,
      generation: 0,
      segmentId: '1',
      startMs: 0,
      revision: 1,
      text: 'private spoken sentence',
      final: true,
    });
    const speech = diagnosticSpeechProgress('speak', sessionId, callback);
    speech({ requestId: sessionId, phase: 'playing' });
    speech({ requestId: sessionId, phase: 'playing' });
    const events = mock.invoke.mock.calls
      .filter((c) => c[0] === 'record_diagnostic')
      .map((c) => c[1].event);
    expect(events.map((e) => e.phase)).toEqual([
      'recognition_metrics',
      'recognition_corrections',
      'playing',
    ]);
    expect(JSON.stringify(events)).not.toContain('private spoken sentence');
    expect(callback).toHaveBeenCalledTimes(5);
  });

  it('records lifecycle and correlation without request arguments or response text', async () => {
    mock.invoke.mockResolvedValue('private-response-text');
    const id = '11111111-2222-4333-8444-555555555555:2';
    const result = await diagnosticInvoke('translate', {
      requestId: id,
      text: 'private-chat-text',
      profile: {
        adapter: 'openai_chat_completions',
        apiKey: 'private-key',
        baseUrl: 'https://private.example',
      },
    });
    expect(result).toBe('private-response-text');
    const events = mock.invoke.mock.calls
      .filter((c) => c[0] === 'record_diagnostic')
      .map((c) => c[1].event);
    expect(events.map((e) => e.kind)).toEqual(['start', 'finish']);
    expect(events[0].correlationId).toBe(id);
    expect(events[0].adapter).toBe('openai_chat_completions');
    expect(events[1].traceId).toBe(events[0].traceId);
    expect(events[1].durationMs).toBeGreaterThanOrEqual(0);
    const serialized = JSON.stringify(events);
    for (const secret of [
      'private-response-text',
      'private-chat-text',
      'private-key',
      'private.example',
    ])
      expect(serialized).not.toContain(secret);
  });
  it('classifies errors without persisting raw messages or masking the original error', async () => {
    const failure = new Error('HTTP 401 private-provider-response private-key');
    mock.invoke.mockImplementation(async (command) => {
      if (command === 'translate') throw failure;
    });
    await expect(diagnosticInvoke('translate', { text: 'private-text' })).rejects.toBe(failure);
    const events = mock.invoke.mock.calls
      .filter((c) => c[0] === 'record_diagnostic')
      .map((c) => c[1].event);
    expect(events.at(-1).reason).toBe('auth');
    expect(JSON.stringify(events)).not.toContain('private-');
    expect(
      errorKind({
        toString() {
          throw new Error('do not stringify');
        },
      }),
    ).toBe('unknown');
    expect(errorKind('翻译服务未返回有效译文')).toBe('invalid_response');
    expect(errorKind('余额不足')).toBe('quota');
    expect(correlationId('private-device-name')).toBeUndefined();
  });
  it('does not log high frequency snapshots and logging failures never break an operation', async () => {
    mock.invoke.mockImplementation(async (command) => {
      if (command === 'record_diagnostic') throw new Error('disk unavailable');
      return 'ok';
    });
    await expect(diagnosticInvoke('speak', { text: 'private' })).resolves.toBe('ok');
    mock.invoke.mockClear();
    await diagnosticInvoke('publish_overlay', { snapshot: { lines: [{ text: 'private' }] } });
    expect(mock.invoke.mock.calls.map((c) => c[0])).toEqual(['publish_overlay']);
  });
});

it('samples audio-quality counters without recording audio or arbitrary event fields', () => {
  mock.invoke.mockResolvedValue(undefined);
  const callback = vi.fn();
  const listener = diagnosticListeningProgress(callback);
  const progress = {
    type: 'progress' as const,
    sessionId: '11111111-2222-4333-8444-555555555555',
    phase: 'running' as const,
    sampleRate: 48000,
    frames: 16000,
    rms: 0.1,
    droppedFrames: 0,
    droppedSegments: 0,
    discontinuities: 0,
    audioQuality: { monoRms: 0, nearPeakFrames: 4, lowDownmixWindows: 2 },
    privateSamples: 'never-log-audio',
  };
  listener(progress);
  listener(progress);
  const quality = mock.invoke.mock.calls.filter((c) => c[1]?.event?.phase === 'audio_quality');
  expect(quality).toHaveLength(1);
  expect(quality[0][1].event).toMatchObject({ count: 4, failedCount: 2 });
  expect(JSON.stringify(quality)).not.toContain('never-log-audio');
  expect(callback).toHaveBeenCalledTimes(2);
});
