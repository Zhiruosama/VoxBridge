import { expect, it, vi } from 'vitest';
import { SendQueue } from './send-queue';
import { defaults } from './settings';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
function fixture() {
  const settings = structuredClone(defaults);
  settings.audio.sendDeviceId = 'virtual';
  for (const p of settings.profiles) {
    p.name = 'Test';
    p.baseUrl = p.stage === 'tts' ? 'wss://example.com' : 'https://example.com';
    p.modelId = 'model';
    p.voice = 'voice';
  }
  const playing = new Map<string, ReturnType<typeof deferred>>();
  const order: string[] = [];
  const play = vi.fn(async (...args: any[]) => {
    const id = typeof args[0] === 'object' && 'sendDeviceId' in args[0] ? args[2] : args[4];
    order.push(id);
    const gate = deferred();
    playing.set(id, gate);
    await gate.promise;
  });
  const deps = {
    detectLanguage: vi.fn(async () => '简体中文'),
    translate: vi.fn(async (_p: any, text: string) => text + ' translated'),
    speak: play,
    prepare: vi.fn(async () => {}),
    playPrepared: play,
    discardPrepared: vi.fn(async () => {}),
    cancelTranslation: vi.fn(async () => {}),
    stopSpeech: vi.fn(async (id: string) => {
      playing.get(id)?.resolve();
    }),
  };
  const queue = new SendQueue(deps);
  const accepted = vi.fn(),
    translation = vi.fn();
  const enqueue = (id: string) =>
    queue.run(
      { id, text: id, settings, action: 'speak' },
      { accepted, translation, phase: () => {} },
    );
  return { queue, deps, settings, playing, order, enqueue, accepted, translation };
}
it('accepts multiple messages, prefetches only the next one, and serializes output', async () => {
  const f = fixture();
  const results = [f.enqueue('one'), f.enqueue('two'), f.enqueue('three')];
  expect(f.accepted).toHaveBeenCalledTimes(3);
  await vi.waitFor(() => expect(f.queue.snapshot().items[1].status).toBe('ready'));
  expect(f.order).toEqual(['one:0']);
  expect(f.deps.prepare).toHaveBeenCalledTimes(1);
  expect(f.deps.translate).toHaveBeenCalledTimes(2);
  f.playing.get('one:0')!.resolve();
  await results[0];
  await vi.waitFor(() => expect(f.order).toEqual(['one:0', 'two:0']));
  await vi.waitFor(() => expect(f.deps.prepare).toHaveBeenCalledTimes(2));
  f.playing.get('two:0')!.resolve();
  await results[1];
  await vi.waitFor(() => expect(f.order).toEqual(['one:0', 'two:0', 'three:0']));
  f.playing.get('three:0')!.resolve();
  await results[2];
  expect(f.queue.busy).toBe(false);
});
it('holds a faster second preparation behind a slow first translation', async () => {
  const f = fixture(),
    first = deferred();
  f.deps.translate.mockImplementation(async (_p, text) => {
    if (text === 'one') await first.promise;
    return text;
  });
  const a = f.enqueue('one'),
    b = f.enqueue('two');
  await vi.waitFor(() => expect(f.deps.prepare).toHaveBeenCalledTimes(1));
  expect(f.order).toEqual([]);
  first.resolve();
  await vi.waitFor(() => expect(f.order).toEqual(['one:0']));
  f.playing.get('one:0')!.resolve();
  await a;
  await vi.waitFor(() => expect(f.order).toEqual(['one:0', 'two:0']));
  f.playing.get('two:0')!.resolve();
  await b;
});
it('stop cancels current output and pauses remaining prepared messages until resumed', async () => {
  const f = fixture();
  const a = f.enqueue('one'),
    b = f.enqueue('two');
  await vi.waitFor(() => expect(f.queue.snapshot().items[1].status).toBe('ready'));
  await f.queue.stop();
  expect(await a).toBe('stopped');
  expect(f.queue.snapshot().paused).toBe(true);
  expect(f.order).toEqual(['one:0']);
  f.queue.resume();
  await vi.waitFor(() => expect(f.order).toEqual(['one:0', 'two:0']));
  f.playing.get('two:0')!.resolve();
  await b;
});
it('failure keeps the original message and pauses the queue; retry uses a new attempt ID', async () => {
  const f = fixture();
  f.deps.translate.mockRejectedValueOnce(new Error('network failed'));
  const a = f.enqueue('one'),
    b = f.enqueue('two');
  await vi.waitFor(() => expect(f.queue.snapshot().items[0].status).toBe('failed'));
  expect(f.queue.snapshot().paused).toBe(true);
  expect(f.order).toEqual([]);
  await f.queue.retry('one');
  await vi.waitFor(() => expect(f.order).toEqual(['one:1']));
  f.playing.get('one:1')!.resolve();
  await a;
  await vi.waitFor(() => expect(f.order).toEqual(['one:1', 'two:0']));
  f.playing.get('two:0')!.resolve();
  await b;
});
it('editing a prepared waiting message discards the old audio and keeps FIFO position', async () => {
  const f = fixture();
  const a = f.enqueue('one'),
    b = f.enqueue('two');
  await vi.waitFor(() => expect(f.queue.snapshot().items[1].status).toBe('ready'));
  await f.queue.edit('two', 'edited');
  await vi.waitFor(() => expect(f.deps.prepare).toHaveBeenCalledTimes(2));
  expect(f.queue.snapshot().items[1].text).toBe('edited');
  f.playing.get('one:0')!.resolve();
  await a;
  await vi.waitFor(() => expect(f.order).toEqual(['one:0', 'two:1']));
  expect(f.translation).toHaveBeenLastCalledWith('edited translated', 'edited');
  f.playing.get('two:1')!.resolve();
  await b;
});
it('canceling a waiting item never plays it, and invalid/full submissions do not clear input', async () => {
  const f = fixture();
  const a = f.enqueue('one'),
    b = f.enqueue('two');
  await vi.waitFor(() => expect(f.queue.snapshot().items[1].status).toBe('ready'));
  await f.queue.cancel('two');
  expect(await b).toBe('stopped');
  f.playing.get('one:0')!.resolve();
  await a;
  expect(f.order).toEqual(['one:0']);
  expect(() =>
    f.queue.run(
      { id: 'empty', text: '', settings: f.settings, action: 'speak' },
      { phase: () => {}, translation: () => {} },
    ),
  ).toThrow();
});
it('late cleanup of an edited preparation cannot unlock newer audio output', async () => {
  const f = fixture(),
    cleanup = deferred();
  const a = f.enqueue('one'),
    b = f.enqueue('two'),
    c = f.enqueue('three');
  await vi.waitFor(() => expect(f.queue.snapshot().items[1].status).toBe('ready'));
  f.deps.discardPrepared.mockImplementation(async (id?: string) => {
    if (id === 'two:0') await cleanup.promise;
  });
  const editing = f.queue.edit('two', 'replacement');
  f.playing.get('one:0')!.resolve();
  await a;
  await vi.waitFor(() => expect(f.order).toEqual(['one:0', 'two:1']));
  cleanup.resolve();
  await editing;
  await vi.waitFor(() =>
    expect(f.queue.snapshot().items.find((i) => i.id === 'three')?.status).toBe('ready'),
  );
  expect(f.queue.snapshot().items.find((i) => i.id === 'two')?.active).toBe(true);
  expect(f.order).toHaveLength(2);
  f.playing.get('two:1')!.resolve();
  await b;
  await vi.waitFor(() => expect(f.order).toEqual(['one:0', 'two:1', 'three:0']));
  f.playing.get('three:0')!.resolve();
  await c;
});
it('bounds the queue and clears all pending preparations on disposal', async () => {
  const f = fixture();
  const promises = Array.from({ length: 10 }, (_, i) => f.enqueue('message-' + i));
  expect(() => f.enqueue('overflow')).toThrow('队列已满');
  expect(f.accepted).toHaveBeenCalledTimes(10);
  await f.queue.clear();
  await Promise.all(promises);
  expect(f.queue.snapshot().items).toEqual([]);
});

it('applies monitoring changes when a prefetched message reaches playback', async () => {
  const f = fixture();
  const a = f.enqueue('one'),
    b = f.enqueue('two');
  await vi.waitFor(() => expect(f.queue.snapshot().items[1].status).toBe('ready'));
  await f.queue.setMonitoring(true);
  f.playing.get('one:0')!.resolve();
  await a;
  await vi.waitFor(() => expect(f.order).toEqual(['one:0', 'two:0']));
  expect(f.deps.playPrepared.mock.calls[1][0].monitorEnabled).toBe(true);
  f.playing.get('two:0')!.resolve();
  await b;
});
