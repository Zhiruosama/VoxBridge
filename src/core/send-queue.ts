import { ComposerController, type ComposerPhase } from './composer';
import { profileFor, validateProfile } from './settings';
import type { Settings, SpeechProgress } from './types';

type Dependencies = ConstructorParameters<typeof ComposerController>[0] & {
  prepare: (
    profile: Settings['profiles'][number] & { language?: string },
    text: string,
    id: string,
  ) => Promise<void>;
  playPrepared: (
    audio: Settings['audio'],
    route: Settings['composer']['route'],
    id: string,
    progress: (event: SpeechProgress) => void,
  ) => Promise<void>;
  discardPrepared: (id: string) => Promise<unknown>;
};
export type QueueAction =
  | { action: 'queuePause' | 'queueResume' }
  | { action: 'queueCancel' | 'queueRetry'; id: string }
  | { action: 'queueEdit'; id: string; text: string };
export type QueueView = {
  paused: boolean;
  items: { id: string; text: string; status: string; error: string; active: boolean }[];
};
type Input = Parameters<ComposerController['run']>[0];
type Callbacks = Omit<Parameters<ComposerController['run']>[1], 'translation'> & {
  translation: (text: string, source?: string) => void;
};
type Job = {
  id: string;
  input: Input;
  callbacks: Callbacks;
  status: string;
  error: string;
  generation: number;
  controller?: ComposerController;
  wake?: () => void;
  resolve: (outcome: 'completed' | 'stopped') => void;
};
export class SendQueue {
  private jobs: Job[] = [];
  private workers = 0;
  private playing: Job | null = null;
  private playingGeneration = -1;
  private paused = false;
  private listeners = new Set<(view: QueueView) => void>();
  constructor(private readonly deps: Dependencies) {}
  get busy() {
    return this.jobs.length > 0;
  }
  subscribe(listener: (view: QueueView) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }
  snapshot(): QueueView {
    return {
      paused: this.paused,
      items: this.jobs.map((j) => ({
        id: j.id,
        text: j.input.text,
        status: j.status,
        error: j.error,
        active: this.playing === j,
      })),
    };
  }
  private emit() {
    const view = this.snapshot();
    this.listeners.forEach((l) => l(view));
    this.jobs.forEach((j) => j.wake?.());
  }
  run(input: Input, callbacks: Callbacks): Promise<'completed' | 'stopped'> {
    if (this.jobs.length >= 10) throw new Error('待发送队列已满（最多 10 条），请稍后再发送。');
    const settings = structuredClone(input.settings),
      route = input.route ?? settings.composer.route;
    if (!input.text.trim() || [...input.text].length > 2000)
      throw new Error('请输入 1–2000 字的内容。');
    const invalid = validateProfile(profileFor(settings, 'tts'));
    if (invalid) throw new Error(invalid);
    if (!(route === 'preview' ? settings.audio.previewDeviceId : settings.audio.sendDeviceId))
      throw new Error('请先选择语音输出设备。');
    if (route === 'send' && settings.audio.monitorEnabled && !settings.audio.previewDeviceId)
      throw new Error('请先选择试听设备，或关闭发送时试听。');
    if (!this.jobs.length) this.paused = false;
    const promise = new Promise<'completed' | 'stopped'>((resolve) =>
      this.jobs.push({
        id: input.id,
        input: { ...input, settings },
        callbacks,
        status: 'queued',
        error: '',
        generation: 0,
        resolve,
      }),
    );
    callbacks.accepted?.();
    this.emit();
    this.pump();
    return promise;
  }
  private pump() {
    if (this.paused) return;
    while (this.workers < 2) {
      const job = this.jobs.find((j) => j.status === 'queued');
      if (!job) break;
      job.status = 'preparing';
      this.workers++;
      void this.process(job, job.generation);
    }
    this.emit();
  }
  private async process(job: Job, generation: number) {
    const valid = () => this.jobs.includes(job) && job.generation === generation;
    const id = `${job.id}:${generation}`;
    let translated: string | undefined;
    const turn = async () => {
      let wake: (() => void) | undefined;
      while (valid() && (this.paused || this.jobs[0] !== job || this.playing))
        await new Promise<void>((resolve) => {
          wake = resolve;
          job.wake = resolve;
        });
      if (job.wake === wake) job.wake = undefined;
      if (!valid()) throw new Error('已取消');
      this.playing = job;
      this.playingGeneration = generation;
      job.status = 'playing';
      if (translated !== undefined) job.callbacks.translation(translated, job.input.text);
      this.emit();
    };
    const controller = new ComposerController({
      ...this.deps,
      stopSpeech: async (request) => {
        await Promise.allSettled([
          this.deps.discardPrepared(request),
          this.deps.stopSpeech(request),
        ]);
      },
      speak: async (profile, text, audio, route, request, progress) => {
        // Keep first-response latency: stream the head, prepare only the following item.
        if (valid() && this.jobs[0] === job && !this.paused && !this.playing) {
          await turn();
          await this.deps.speak(profile, text, audio, route, request, progress);
        } else {
          if (!valid()) throw new Error('已取消');
          job.status = 'synthesizing';
          this.emit();
          await this.deps.prepare(profile, text, request);
          if (!valid()) throw new Error('已取消');
          job.status = 'ready';
          this.emit();
          await turn();
          await this.deps.playPrepared(
            { ...audio, monitorEnabled: job.input.settings.audio.monitorEnabled },
            route,
            request,
            progress,
          );
        }
      },
    });
    job.controller = controller;
    try {
      const outcome = await controller.run(
        { ...job.input, id },
        {
          translation: (value) => {
            translated = value;
          },
          notice: job.callbacks.notice,
          phase: (phase) => {
            if (!valid()) return;
            if (phase !== 'idle') {
              job.status = phase;
              if (this.playing === job) job.callbacks.phase(phase as ComposerPhase);
            }
            this.emit();
          },
        },
      );
      if (valid()) {
        this.jobs = this.jobs.filter((j) => j !== job);
        job.resolve(outcome === 'completed' ? 'completed' : 'stopped');
      }
    } catch (error) {
      if (valid()) {
        job.status = 'failed';
        job.error = Array.from(String(error).replace(/^Error: /, ''))
          .slice(0, 400)
          .join('');
        this.paused = true;
        job.callbacks.notice?.(job.error);
      }
    } finally {
      await this.deps.discardPrepared(id).catch(() => {});
      if (this.playing === job && this.playingGeneration === generation) this.playing = null;
      if (valid() && job.generation === generation) job.controller = undefined;
      this.workers--;
      this.emit();
      this.pump();
    }
  }
  pause() {
    this.paused = true;
    this.emit();
  }
  resume() {
    if (this.jobs.some((j) => j.status === 'failed')) return;
    this.paused = false;
    this.emit();
    this.pump();
  }
  async cancel(id: string) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    if (this.playing === job) this.paused = true;
    this.jobs = this.jobs.filter((j) => j !== job);
    job.wake?.();
    this.emit();
    await job.controller?.cancel();
    job.resolve('stopped');
    this.pump();
  }
  async stop() {
    this.pause();
    if (this.playing) await this.cancel(this.playing.id);
    else {
      const head = this.jobs[0];
      if (head && head.status !== 'failed') await this.cancel(head.id);
    }
  }
  async retry(id: string, settings?: Settings) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.status !== 'failed') return;
    job.generation++;
    if (settings) job.input = { ...job.input, settings: structuredClone(settings) };
    job.error = '';
    job.status = 'queued';
    this.resume();
  }
  async edit(id: string, text: string) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || this.playing === job || !text.trim() || [...text].length > 2000) return;
    const old = job.controller;
    job.generation++;
    job.wake?.();
    job.input = { ...job.input, text };
    job.error = '';
    job.status = 'queued';
    job.controller = undefined;
    this.emit();
    await old?.cancel();
    this.pump();
  }
  async setMonitoring(enabled: boolean) {
    await Promise.allSettled(
      this.jobs.map((j) => {
        j.input.settings.audio.monitorEnabled = enabled;
        return j.controller?.setMonitoring(enabled);
      }),
    );
  }
  async clear() {
    this.pause();
    await Promise.allSettled(this.jobs.map((j) => this.cancel(j.id)));
  }
}
