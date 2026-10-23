import { describe, expect, it } from 'vitest';
import { captureSourceKey, captureSourceLabel } from './capture-sources';

describe('application capture identity', () => {
  it('keeps application selection when its process restarts, without merging different apps', () => {
    const chrome = {
      pid: 10,
      bundleId: 'com.google.Chrome',
      name: 'Google Chrome',
      appScoped: true,
    };
    expect(captureSourceKey({ ...chrome, pid: 20 })).toBe(captureSourceKey(chrome));
    expect(captureSourceKey({ ...chrome, bundleId: 'com.tencent.xinWeChat' })).not.toBe(
      captureSourceKey(chrome),
    );
    expect(captureSourceLabel(chrome)).toBe('Google Chrome');
  });
  it('retains exact identity for legacy process targets and avoids PID labels', () => {
    const process = { pid: 10, bundleId: 'example.helper' };
    expect(captureSourceKey({ ...process, pid: 20 })).not.toBe(captureSourceKey(process));
    expect(captureSourceLabel(process)).toBe('example.helper');
    expect(captureSourceLabel({ pid: 10, bundleId: '' })).toBe('未命名应用');
  });
});
