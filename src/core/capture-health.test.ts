import { describe, expect, it } from 'vitest';
import { CaptureSignalMonitor } from './capture-health';

describe('capture signal health', () => {
  it('starts the grace period only when capture is ready', () => {
    const monitor = new CaptureSignalMonitor();
    expect(monitor.update({ frames: 0, rms: 0 }, 9000)).toBe('waiting');
    expect(monitor.update({ frames: 48000, rms: 0 }, 10000)).toBe('waiting');
    expect(monitor.update({ frames: 96000, rms: 0 }, 12000)).toBe('silent');
  });

  it('distinguishes missing callbacks from delivered silent frames', () => {
    const monitor = new CaptureSignalMonitor();
    monitor.update({ frames: 0, rms: 0 }, 0);
    expect(monitor.update({ frames: 0, rms: 0 }, 3000)).toBe('stalled');
    expect(monitor.update({ frames: 48000, rms: 0 }, 3250)).toBe('silent');
  });

  it('keeps normal pauses after speech free of permission warnings', () => {
    const monitor = new CaptureSignalMonitor();
    expect(monitor.update({ frames: 12000, rms: 0.1 }, 0)).toBe('active');
    expect(monitor.update({ frames: 240000, rms: 0 }, 5000)).toBe('active');
    expect(monitor.update({ frames: 480000, rms: 0 }, 10000)).toBe('active');
    expect(monitor.update({ frames: 480000, rms: 0 }, 13000)).toBe('stalled');
    expect(monitor.update({ frames: 492000, rms: 0 }, 13250)).toBe('active');
  });

  it('recovers from initial silence and resets with each new session', () => {
    const monitor = new CaptureSignalMonitor();
    monitor.update({ frames: 1000, rms: 0 }, 0);
    expect(monitor.update({ frames: 144000, rms: 0 }, 3000)).toBe('silent');
    expect(monitor.update({ frames: 156000, rms: 0.04 }, 3250)).toBe('active');
    expect(new CaptureSignalMonitor().update({ frames: 0, rms: 0 }, 9000)).toBe('waiting');
  });
});
