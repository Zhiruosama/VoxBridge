import type { CaptureSource } from './types';

/** App identity survives audio helper and application process restarts. */
export function captureSourceKey(source: CaptureSource): string {
  return source.appScoped ? `app:${source.bundleId}` : `process:${source.pid}:${source.bundleId}`;
}

export function captureSourceLabel(source: CaptureSource): string {
  return source.name?.trim() || source.bundleId || '未命名应用';
}
