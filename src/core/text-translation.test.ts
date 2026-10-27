import { describe, expect, it, vi } from 'vitest';
import { TextTranslationController, textTranslationSubmitKey } from './text-translation';
import { defaults, profileFor } from './settings';

function fixture() {
  const dependencies = {
    translate: vi.fn<typeof import('../bridge').translate>(async () => 'Hello'),
    cancelTranslation: vi.fn(async (_id: string) => {}),
  };
  const controller = new TextTranslationController(dependencies, '英语');
  const profile = {
    ...profileFor(defaults, 'translation'),
    baseUrl: 'https://example.com',
    modelId: 'flash',
  };
  return { dependencies, controller, profile };
}
function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('independent text translation', () => {
  it('uses only the translation profile and preserves multiline input', async () => {
    const { controller, dependencies, profile } = fixture();
    controller.update({ input: '你好\n朋友', target: '日语' });
    await controller.submit(profile);
    expect(dependencies.translate).toHaveBeenCalledWith(
      profile,
      '你好\n朋友',
      '自动识别',
      '日语',
      expect.any(String),
    );
    expect(controller.getSnapshot()).toMatchObject({
      input: '你好\n朋友',
      result: 'Hello',
      resultTarget: '日语',
      busy: false,
    });
  });
  it('lets the next draft change during a request without duplicate submission or target confusion', async () => {
    const { controller, dependencies, profile } = fixture();
    const pending = deferred();
    dependencies.translate.mockReturnValueOnce(pending.promise);
    controller.update({ input: '第一段' });
    const task = controller.submit(profile);
    controller.update({ input: '第二段', target: '德语' });
    await controller.submit(profile);
    pending.resolve('First message');
    await task;
    expect(dependencies.translate).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      input: '第二段',
      target: '德语',
      result: 'First message',
      resultTarget: '英语',
    });
  });
  it('ignores late results after cancellation and a new request', async () => {
    const { controller, dependencies, profile } = fixture();
    const old = deferred();
    dependencies.translate.mockReturnValueOnce(old.promise);
    controller.update({ input: '旧的' });
    const task = controller.submit(profile);
    controller.cancel();
    controller.update({ input: '新的' });
    await controller.submit(profile);
    old.resolve('Stale');
    await task;
    expect(controller.getSnapshot().result).toBe('Hello');
    expect(dependencies.cancelTranslation).toHaveBeenCalledTimes(1);
  });
  it('clear cancels work and ignores its late failure', async () => {
    const { controller, dependencies, profile } = fixture();
    const pending = deferred();
    dependencies.translate.mockReturnValueOnce(pending.promise);
    controller.update({ input: '你好' });
    const task = controller.submit(profile);
    controller.clear();
    pending.reject(new Error('Late error'));
    await task;
    expect(controller.getSnapshot()).toMatchObject({
      input: '',
      result: '',
      error: '',
      busy: false,
    });
  });
  it('keeps the last successful result when a new translation fails', async () => {
    const { controller, dependencies, profile } = fixture();
    controller.update({ input: '你好' });
    await controller.submit(profile);
    dependencies.translate.mockRejectedValueOnce(new Error('Unavailable'));
    controller.update({ input: '再见' });
    await controller.submit(profile);
    expect(controller.getSnapshot()).toMatchObject({
      input: '再见',
      result: 'Hello',
      error: 'Unavailable',
      busy: false,
    });
  });
  it('rejects blank, oversized and unconfigured input before any request', async () => {
    const { controller, dependencies, profile } = fixture();
    await controller.submit(profile);
    controller.update({ input: '字'.repeat(2001) });
    await controller.submit(profile);
    controller.update({ input: '你好' });
    await controller.submit({ ...profile, modelId: '' });
    expect(dependencies.translate).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toBeTruthy();
  });
  it('counts Unicode characters, supports the boundary and bypasses explicit same language', async () => {
    const { controller, dependencies, profile } = fixture();
    controller.update({ input: '😀'.repeat(2000) });
    await controller.submit(profile);
    expect(dependencies.translate).toHaveBeenCalledTimes(1);
    controller.update({ input: 'Hello', source: '英语' });
    await controller.submit(profile);
    expect(dependencies.translate).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().result).toBe('Hello');
  });
  it('retains the snapshot when a page unsubscribes and reopens', async () => {
    const { controller, profile } = fixture();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.update({ input: '你好' });
    unsubscribe();
    await controller.submit(profile);
    const reopened = vi.fn();
    const close = controller.subscribe(reopened);
    expect(controller.getSnapshot()).toMatchObject({ input: '你好', result: 'Hello' });
    controller.update({ input: '继续' });
    expect(reopened).toHaveBeenCalledTimes(1);
    close();
  });
});

describe('text translation Enter behavior', () => {
  const enter = { key: 'Enter', shiftKey: false, altKey: false, isComposing: false };
  it('sends on Enter and leaves Shift+Enter available for newlines', () => {
    expect(textTranslationSubmitKey(enter)).toBe(true);
    expect(textTranslationSubmitKey({ ...enter, shiftKey: true })).toBe(false);
    expect(textTranslationSubmitKey({ ...enter, key: 'a' })).toBe(false);
  });
  it('does not send when confirming IME candidates, including Safari keyCode 229', () => {
    expect(textTranslationSubmitKey({ ...enter, isComposing: true })).toBe(false);
    expect(textTranslationSubmitKey({ ...enter, keyCode: 229 })).toBe(false);
  });
});

describe('text translation recovery', () => {
  it('retries the failed snapshot with current credentials without overwriting a newer draft', async () => {
    const { controller, dependencies, profile } = fixture();
    dependencies.translate.mockRejectedValueOnce(new Error('network offline'));
    controller.update({ input: '第一条', target: '日语' });
    await controller.submit(profile);
    expect(controller.getSnapshot().canRetry).toBe(true);
    controller.update({ input: '下一条', target: '德语' });
    await controller.retry({ ...profile, modelId: 'replacement' });
    expect(dependencies.translate.mock.calls[1].slice(1, 4)).toEqual([
      '第一条',
      '自动识别',
      '日语',
    ]);
    expect(dependencies.translate.mock.calls[1][0].modelId).toBe('replacement');
    expect(controller.getSnapshot()).toMatchObject({
      input: '下一条',
      target: '德语',
      resultTarget: '日语',
      canRetry: false,
    });
  });
  it('releases a stalled request after the deadline, retains text and permits retry', async () => {
    vi.useFakeTimers();
    try {
      const { controller, dependencies, profile } = fixture();
      dependencies.translate.mockReturnValueOnce(new Promise(() => {}));
      controller.update({ input: '保留这段内容' });
      const request = controller.submit(profile);
      await vi.advanceTimersByTimeAsync(45000);
      await request;
      expect(controller.getSnapshot()).toMatchObject({
        input: '保留这段内容',
        busy: false,
        canRetry: true,
      });
      expect(dependencies.cancelTranslation).toHaveBeenCalledTimes(1);
      await controller.retry(profile);
      expect(controller.getSnapshot().result).toBe('Hello');
    } finally {
      vi.useRealTimers();
    }
  });
});

it('clipboard replacement cancels old work, clears stale output and does not translate until requested', async () => {
  const { controller, dependencies, profile } = fixture();
  const old = deferred();
  dependencies.translate.mockReturnValueOnce(old.promise);
  controller.update({ input: 'old copied text' });
  const task = controller.submit(profile);
  controller.acceptClipboard('new copied text');
  expect(controller.getSnapshot()).toMatchObject({
    input: 'new copied text',
    result: '',
    busy: false,
    error: '',
  });
  old.resolve('stale result');
  await task;
  expect(controller.getSnapshot().result).toBe('');
  expect(dependencies.translate).toHaveBeenCalledOnce();
  await controller.submit(profile);
  expect(controller.getSnapshot().result).toBe('Hello');
  expect(dependencies.cancelTranslation).toHaveBeenCalledOnce();
});
