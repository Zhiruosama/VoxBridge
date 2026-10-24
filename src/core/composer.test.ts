import { describe, expect, it, vi } from 'vitest';
import { ComposerController, composerKeyAction, composerLanguages } from './composer';
import { defaults } from './settings';

function fixture() {
  const settings = structuredClone(defaults);
  settings.audio = {
    previewDeviceId: 'headphones',
    sendDeviceId: 'virtual',
    monitorEnabled: false,
  };
  settings.profiles[1] = {
    ...settings.profiles[1],
    baseUrl: 'https://example.com/v1',
    modelId: 'translation-model',
  };
  settings.profiles[2] = {
    ...settings.profiles[2],
    baseUrl: 'wss://tts.example.com',
    modelId: 'speech-model',
    voice: 'voice',
  };
  const dependencies = {
    translate: vi.fn<typeof import('../bridge').translate>(async () => 'Hello'),
    speak: vi.fn<typeof import('../bridge').speak>(async () => {}),
    setMonitoring: vi.fn(async (_id: string, _enabled: boolean) => {}),
    cancelTranslation: vi.fn(async () => {}),
    stopSpeech: vi.fn(async () => {}),
  };
  const controller = new ComposerController(dependencies);
  const callbacks = { phase: vi.fn(), translation: vi.fn() };
  const input = { id: 'request', text: '你好', settings, action: 'speak' as const };
  return { settings, dependencies, controller, callbacks, input };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('selected language and direct speech', () => {
  it('keeps the current voice snapshot while later submissions use the changed voice', async () => {
    const { input, dependencies, controller, callbacks } = fixture();
    const translation = deferred<string>();
    dependencies.translate.mockImplementationOnce(() => translation.promise);
    const current = controller.run({ ...input, listening: true }, callbacks);
    input.settings.profiles[2] = {
      ...input.settings.profiles[2],
      voice: 'next-voice',
      modelId: 'next-model',
    };
    translation.resolve('Hello');
    await current;
    expect(dependencies.speak.mock.calls[0]?.[0]).toMatchObject({
      voice: 'voice',
      modelId: 'speech-model',
    });
    await controller.run({ ...input, id: 'next-request', listening: true }, callbacks);
    expect(dependencies.speak.mock.calls[1]?.[0]).toMatchObject({
      voice: 'next-voice',
      modelId: 'next-model',
    });
  });
  it.each(['英语', '简体中文', '日语', '韩语', '西班牙语', '印尼语', '粤语', '芬兰语', '俄语'])(
    'passes %s as both translation target and synthesized speech language',
    async (target) => {
      const { input, dependencies, controller, callbacks } = fixture();
      input.settings.targetLanguage = target;
      input.settings.listening = { sourceLanguage: '英语', targetLanguage: '简体中文' };
      await controller.run({ ...input, listening: true }, callbacks);
      expect(dependencies.translate.mock.calls[0]?.[3]).toBe(target);
      expect(dependencies.speak.mock.calls[0]?.[0].language).toBe(target);
      expect(dependencies.speak.mock.calls[0]?.[1]).toBe('Hello');
    },
  );
  it('skips translation and its configuration requirements when actual input matches target', async () => {
    const { input, dependencies, callbacks } = fixture();
    input.text = '今日はとてもいい天気ですね。';
    input.settings.targetLanguage = '日语';
    input.settings.sourceLanguage = '简体中文';
    input.settings.profiles[1].modelId = '';
    const controller = new ComposerController({
      ...dependencies,
      detectLanguage: async () => '日语',
    });
    await controller.run(input, callbacks);
    expect(dependencies.translate).not.toHaveBeenCalled();
    expect(dependencies.speak.mock.calls[0]?.[1]).toBe(input.text);
    expect(dependencies.speak.mock.calls[0]?.[0].language).toBe('日语');
    expect(callbacks.translation).toHaveBeenCalledWith(input.text);
  });
  it('does not trust the source dropdown when actual input is different or uncertain', async () => {
    for (const detected of ['简体中文', null]) {
      const { input, dependencies, callbacks } = fixture();
      input.settings.sourceLanguage = input.settings.targetLanguage = '英语';
      const controller = new ComposerController({
        ...dependencies,
        detectLanguage: async () => detected,
      });
      await controller.run(input, callbacks);
      expect(dependencies.translate).toHaveBeenCalledOnce();
    }
  });
  it('locks the submission during detection and does not speak after cancellation', async () => {
    const { input, dependencies, callbacks } = fixture();
    const detection = deferred<string | null>();
    const controller = new ComposerController({
      ...dependencies,
      detectLanguage: () => detection.promise,
    });
    const running = controller.run(input, callbacks);
    expect(callbacks.phase).toHaveBeenCalledWith('detecting');
    expect(await controller.run(input, callbacks)).toBe('busy');
    await controller.cancel();
    detection.resolve('英语');
    expect(await running).toBe('stopped');
    expect(dependencies.translate).not.toHaveBeenCalled();
    expect(dependencies.speak).not.toHaveBeenCalled();
  });
});

describe('composer operation', () => {
  it('accepts a validated submission once while holding the operation lock', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    const speech = deferred<void>();
    dependencies.speak.mockReturnValue(speech.promise);
    const accepted = vi.fn(() => expect(controller.busy).toBe(true));
    const running = controller.run(input, { ...callbacks, accepted });
    expect(accepted).toHaveBeenCalledOnce();
    expect(await controller.run({ ...input, id: 'next' }, { ...callbacks, accepted })).toBe('busy');
    expect(accepted).toHaveBeenCalledOnce();
    speech.resolve();
    expect(await running).toBe('completed');
  });
  it('does not accept or clear the draft when validation fails', async () => {
    const { controller, input, callbacks } = fixture();
    const accepted = vi.fn();
    input.settings.audio.sendDeviceId = '';
    await expect(controller.run(input, { ...callbacks, accepted })).rejects.toThrow('发送设备');
    expect(accepted).not.toHaveBeenCalled();
    expect(controller.busy).toBe(false);
  });

  it('translates then speaks the returned text with the exact selected route', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    expect(await controller.run(input, callbacks)).toBe('completed');
    expect(dependencies.speak).toHaveBeenCalledWith(
      { ...input.settings.profiles[2], language: '英语' },
      'Hello',
      input.settings.audio,
      'send',
      'request',
      expect.any(Function),
    );
    expect(callbacks.phase.mock.calls.map(([phase]) => phase)).toEqual([
      'translating',
      'synthesizing',
      'idle',
    ]);
    expect(callbacks.translation).toHaveBeenCalledWith('Hello');
    expect(controller.busy).toBe(false);
  });
  it('updates monitoring without synthesizing twice or changing the send route', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    const translation = deferred<string>();
    const speech = deferred<void>();
    dependencies.translate.mockReturnValue(translation.promise);
    dependencies.speak.mockReturnValue(speech.promise);
    const running = controller.run(input, callbacks);
    await controller.setMonitoring(true);
    expect(dependencies.setMonitoring).not.toHaveBeenCalled();
    translation.resolve('Hello');
    await Promise.resolve();
    await Promise.resolve();
    expect(dependencies.speak.mock.calls[0]?.[2].monitorEnabled).toBe(true);
    expect(dependencies.speak.mock.calls[0]?.[3]).toBe('send');
    await controller.setMonitoring(false);
    expect(dependencies.setMonitoring).toHaveBeenCalledWith('request', false);
    speech.resolve();
    await running;
    expect(dependencies.translate).toHaveBeenCalledOnce();
    expect(dependencies.speak).toHaveBeenCalledOnce();
  });
  it('reports monitor failure without changing speech progress or cancelling the send', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    const notice = vi.fn();
    dependencies.speak.mockImplementation(async (_profile, _text, _audio, _route, id, progress) => {
      progress({ requestId: id, phase: 'playing' });
      progress({ requestId: id, phase: 'monitorUnavailable' });
    });
    expect(await controller.run(input, { ...callbacks, notice })).toBe('completed');
    expect(notice).toHaveBeenCalledOnce();
    expect(dependencies.stopSpeech).not.toHaveBeenCalled();
    expect(callbacks.phase.mock.calls.map(([phase]) => phase)).not.toContain('monitorUnavailable');
  });
  it('source mode bypasses translation even without a translation service', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    input.settings.composer.output = 'source';
    input.settings.profiles[1].modelId = '';
    await controller.run({ ...input, route: 'preview' }, callbacks);
    expect(dependencies.translate).not.toHaveBeenCalled();
    expect(dependencies.speak.mock.calls[0]?.[1]).toBe('你好');
  });
  it('translate-only does not require a TTS profile or output device', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    input.settings.audio.sendDeviceId = '';
    input.settings.profiles[2].modelId = '';
    await controller.run({ ...input, action: 'translate' }, callbacks);
    expect(dependencies.translate).toHaveBeenCalledOnce();
    expect(dependencies.speak).not.toHaveBeenCalled();
  });
  it('rejects missing output before making any service request', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    input.settings.audio.sendDeviceId = '';
    await expect(controller.run(input, callbacks)).rejects.toThrow('发送设备');
    expect(dependencies.translate).not.toHaveBeenCalled();
    expect(dependencies.speak).not.toHaveBeenCalled();
  });
  it('does not speak after failed or empty translation', async () => {
    for (const failure of [true, false]) {
      const { controller, input, callbacks, dependencies } = fixture();
      dependencies.translate.mockImplementation(async () => {
        if (failure) throw new Error('offline');
        return '';
      });
      await expect(controller.run(input, callbacks)).rejects.toThrow();
      expect(dependencies.speak).not.toHaveBeenCalled();
      expect(controller.busy).toBe(false);
    }
  });
  it('accepts a minute-sized draft and translation above the old 500-character limit', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    input.text = '你好'.repeat(400);
    dependencies.translate.mockResolvedValue('Hello there. '.repeat(80));
    await controller.run(input, callbacks);
    expect(dependencies.speak).toHaveBeenCalledWith(
      expect.anything(),
      'Hello there. '.repeat(80),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
  it('keeps long translations visible without invoking TTS', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    dependencies.translate.mockResolvedValue('文'.repeat(2001));
    await expect(controller.run(input, callbacks)).rejects.toThrow('超过 2000 字');
    expect(callbacks.translation).toHaveBeenCalledWith('文'.repeat(2001));
    expect(dependencies.speak).not.toHaveBeenCalled();
  });
  it('rejects double submissions and prevents late translation from starting TTS after cancel', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    const pending = deferred<string>();
    dependencies.translate.mockReturnValue(pending.promise);
    const first = controller.run(input, callbacks);
    expect(await controller.run({ ...input, id: 'second' }, callbacks)).toBe('busy');
    await controller.cancel();
    expect(dependencies.cancelTranslation).toHaveBeenCalledWith('request');
    expect(controller.busy).toBe(true);
    pending.resolve('late');
    expect(await first).toBe('stopped');
    expect(callbacks.translation).not.toHaveBeenCalled();
    expect(dependencies.speak).not.toHaveBeenCalled();
    expect(controller.busy).toBe(false);
  });
  it('keeps cancellation effective even when cancellation IPC fails', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    const pending = deferred<string>();
    dependencies.translate.mockReturnValue(pending.promise);
    dependencies.cancelTranslation.mockRejectedValue(new Error('IPC failed'));
    const running = controller.run(input, callbacks);
    await expect(controller.cancel()).rejects.toThrow('IPC failed');
    pending.resolve('late');
    expect(await running).toBe('stopped');
    expect(dependencies.speak).not.toHaveBeenCalled();
  });
  it('cancels at the phase boundary without leaving an idle gap', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    callbacks.translation.mockImplementation(() => {
      void controller.cancel();
    });
    expect(await controller.run(input, callbacks)).toBe('stopped');
    expect(dependencies.speak).not.toHaveBeenCalled();
  });
  it('uses an immutable snapshot while translation is pending', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    const pending = deferred<string>();
    dependencies.translate.mockReturnValue(pending.promise);
    const running = controller.run(input, callbacks);
    input.settings.audio.sendDeviceId = 'changed';
    input.settings.profiles[2].modelId = 'changed';
    input.settings.composer.output = 'source';
    pending.resolve('Hello');
    await running;
    expect(dependencies.speak.mock.calls[0]?.[2].sendDeviceId).toBe('virtual');
    expect(dependencies.speak.mock.calls[0]?.[0].modelId).toBe('speech-model');
  });
  it('ignores stale progress and cancels playback by the current operation ID', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    input.settings.composer.output = 'source';
    const pending = deferred<void>();
    dependencies.speak.mockImplementation(
      async (_profile, _text, _audio, _route, _id, progress) => {
        progress({ requestId: 'old', phase: 'playing' });
        progress({ requestId: 'request', phase: 'playing' });
        await pending.promise;
        progress({ requestId: 'request', phase: 'playing' });
      },
    );
    const running = controller.run(input, callbacks);
    await controller.cancel();
    pending.resolve();
    expect(await running).toBe('stopped');
    expect(dependencies.stopSpeech).toHaveBeenCalledWith('request');
    expect(callbacks.phase.mock.calls.map(([phase]) => phase)).toEqual([
      'synthesizing',
      'playing',
      'idle',
    ]);
  });
});

it('ignores completed-operation progress both when idle and during another operation', async () => {
  const { controller, input, callbacks, dependencies } = fixture();
  input.settings.composer.output = 'source';
  let oldProgress!: Parameters<typeof import('../bridge').speak>[5];
  dependencies.speak.mockImplementationOnce(async (_p, _t, _a, _r, _id, progress) => {
    oldProgress = progress;
  });
  await controller.run(input, callbacks);
  callbacks.phase.mockClear();
  oldProgress({ requestId: 'request', phase: 'playing' });
  expect(callbacks.phase).not.toHaveBeenCalled();
  const pending = deferred<void>();
  dependencies.speak.mockReturnValueOnce(pending.promise);
  const second = controller.run({ ...input, id: 'second' }, callbacks);
  oldProgress({ requestId: 'request', phase: 'playing' });
  expect(callbacks.phase.mock.calls).toEqual([['synthesizing']]);
  pending.resolve();
  await second;
  expect(controller.busy).toBe(false);
});

const enter = {
  key: 'Enter',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  repeat: false,
};
describe('composer keyboard', () => {
  it('submits with configured Enter action and preserves Shift+Enter', () => {
    expect(composerKeyAction(enter, 'speak')).toBe('speak');
    expect(composerKeyAction(enter, 'translate')).toBe('translate');
    expect(composerKeyAction(enter, 'newline')).toBe('newline');
    expect(composerKeyAction({ ...enter, shiftKey: true }, 'speak')).toBe('newline');
  });
  it('does not submit an IME confirmation, repeated key or other key', () => {
    expect(composerKeyAction({ ...enter, isComposing: true }, 'speak')).toBe('ignore');
    expect(composerKeyAction({ ...enter, keyCode: 229 }, 'speak')).toBe('ignore');
    expect(composerKeyAction({ ...enter, repeat: true }, 'speak')).toBe('ignore');
    expect(composerKeyAction({ ...enter, key: 'a' }, 'speak')).toBe('ignore');
  });
});

describe('duplex expression', () => {
  it('uses the selected output language even while listening in another direction', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    input.settings.sourceLanguage = '简体中文';
    input.settings.targetLanguage = '日语';
    input.settings.listening = { sourceLanguage: '英语', targetLanguage: '简体中文' };
    await controller.run({ ...input, listening: true }, callbacks);
    expect(dependencies.translate).toHaveBeenCalledWith(
      input.settings.profiles[1],
      '你好',
      '简体中文',
      '日语',
      'request',
    );
    expect(input.settings.sourceLanguage).toBe('简体中文');
    expect(composerLanguages(input.settings, false)).toEqual({
      source: '简体中文',
      target: '日语',
    });
    expect(dependencies.speak).toHaveBeenCalledOnce();
  });
  it('keeps a send independent of changing listening state and can cancel a missing-device wait', async () => {
    const { controller, input, callbacks, dependencies } = fixture();
    const speech = deferred<void>();
    dependencies.speak.mockImplementation(async (_profile, _text, _audio, _route, id, progress) => {
      progress({ requestId: id, phase: 'waitingDevice' });
      await speech.promise;
    });
    const running = controller.run({ ...input, listening: true }, callbacks);
    await vi.waitFor(() => expect(callbacks.phase).toHaveBeenCalledWith('waitingDevice'));
    await controller.cancel();
    expect(dependencies.stopSpeech).toHaveBeenCalledWith('request');
    speech.resolve();
    expect(await running).toBe('stopped');
  });
});

it('keeps output language independent from changes in the listening source', () => {
  const settings = structuredClone(defaults);
  settings.sourceLanguage = '简体中文';
  settings.targetLanguage = '英语';
  expect(composerLanguages(settings, true)).toEqual({ source: '简体中文', target: '英语' });
  settings.listening = { sourceLanguage: '自动识别', targetLanguage: '英语' };
  expect(composerLanguages(settings, true)).toEqual({ source: '简体中文', target: '英语' });
  settings.listening = { sourceLanguage: '日语', targetLanguage: '简体中文' };
  expect(composerLanguages(settings, true)).toEqual({ source: '简体中文', target: '英语' });
  expect(composerLanguages(settings, false)).toEqual({ source: '简体中文', target: '英语' });
});
