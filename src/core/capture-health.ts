export type CaptureHealth = 'waiting' | 'active' | 'silent' | 'stalled';

/** Frame delivery and signal energy are separate; silence does not prove a permission failure. */
export class CaptureSignalMonitor {
  private startedAt: number | null = null;
  private lastFrameAt = 0;
  private frames = 0;
  private heardAudio = false;

  update(progress: { frames: number; rms: number }, now = performance.now()): CaptureHealth {
    if (this.startedAt === null) {
      this.startedAt = now;
      this.lastFrameAt = now;
    }
    if (progress.frames > this.frames) {
      this.frames = progress.frames;
      this.lastFrameAt = now;
      if (progress.rms > 0.00001) this.heardAudio = true;
    }
    if (now - this.lastFrameAt >= 3000) return 'stalled';
    if (this.heardAudio) return 'active';
    return now - this.startedAt >= 3000 ? 'silent' : 'waiting';
  }
}

export function captureHealthMessage(health: CaptureHealth): string {
  switch (health) {
    case 'waiting':
      return '采集已就绪，请播放目标应用声音。';
    case 'stalled':
      return '音频帧未更新，请确认目标进程仍在运行；可停止后重新选择进程。';
    case 'silent':
      return '正在接收静音帧，请确认选中的进程正在发声；若持续静音，请检查系统设置 → 隐私与安全性 → 屏幕与系统音频录制中的授权，并重启应用。';
    case 'active':
      return '';
  }
}
