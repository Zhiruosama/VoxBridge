import { expect, it, vi } from 'vitest';
import { preflightComposer } from './composer-preflight';
import { ComposerController } from './composer';
import { defaults } from './settings';

function fixture() {
  const settings = structuredClone(defaults);
  const tts = settings.profiles[2];
  Object.assign(tts, {
    baseUrl: 'https://example.com',
    adapter: 'openai_audio_speech',
    modelId: 'tts',
    voice: 'test',
  });
  const deps = {
    detect: vi.fn(async (): Promise<string | null> => null),
    output: vi.fn(async (_id: string) => {}),
  };
  return { settings, deps };
}
it('rejects the report’s blank translation setup before queue acceptance or output', async () => {
  const { settings, deps } = fixture();
  await expect(preflightComposer(settings, '你好', 'speak', 'send', deps)).rejects.toMatchObject({
    section: 'translation',
  });
  expect(deps.output).not.toHaveBeenCalled();
});
it('allows original speech without configuring translation and inspects the virtual route', async () => {
  const { settings, deps } = fixture();
  settings.composer.output = 'source';
  await preflightComposer(settings, '你好', 'speak', 'send', deps);
  expect(deps.detect).not.toHaveBeenCalled();
  expect(deps.output).toHaveBeenCalledExactlyOnceWith('__virtual_microphone__');
});
it('preserves same-language bypass and reuses its detection instead of detecting twice', async () => {
  const { settings, deps } = fixture();
  deps.detect.mockResolvedValue('英语');
  const detection = await preflightComposer(settings, 'Hello there.', 'speak', 'send', deps);
  const speak = vi.fn(async () => {});
  const detectLanguage = vi.fn(async () => null);
  await new ComposerController({
    detectLanguage,
    speak,
    translate: vi.fn(async () => ''),
    stopSpeech: vi.fn(),
    cancelTranslation: vi.fn(),
  }).run(
    { id: 'fixture', text: 'Hello there.', settings, action: 'speak', detection },
    { phase: vi.fn(), translation: vi.fn() },
  );
  expect(detectLanguage).not.toHaveBeenCalled();
  expect(speak).toHaveBeenCalledOnce();
});
it('rejects missing speech setup and disconnected routes without producing any speech', async () => {
  const { settings, deps } = fixture();
  settings.composer.output = 'source';
  deps.output.mockRejectedValue(new Error('虚拟麦克风未就绪'));
  await expect(preflightComposer(settings, '你好', 'speak', 'send', deps)).rejects.toMatchObject({
    section: 'general',
  });
  settings.profiles[2].baseUrl = '';
  deps.output.mockClear();
  await expect(preflightComposer(settings, '你好', 'speak', 'send', deps)).rejects.toMatchObject({
    section: 'tts',
  });
  expect(deps.output).not.toHaveBeenCalled();
});
it('checks local monitoring only on send and leaves translate-only independent of audio', async () => {
  const { settings, deps } = fixture();
  settings.composer.output = 'source';
  settings.audio.monitorEnabled = true;
  await preflightComposer(settings, '你好', 'speak', 'send', deps);
  expect(deps.output.mock.calls.map(([id]) => id)).toEqual([
    '__virtual_microphone__',
    '__system_default__',
  ]);
  deps.output.mockClear();
  deps.detect.mockResolvedValue('英语');
  await preflightComposer(settings, 'Hello', 'translate', 'send', deps);
  expect(deps.output).not.toHaveBeenCalled();
});
