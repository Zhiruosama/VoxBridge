import { describe, expect, it } from 'vitest';
import { recoveryHint } from './operation-feedback';
describe('actionable recovery suggestions', () => {
  it('distinguishes credentials, service limits, connection and device failures', () => {
    expect(recoveryHint('401 unauthorized')).toContain('密钥');
    expect(recoveryHint('429 rate limit')).toContain('稍等');
    expect(recoveryHint('insufficient credits')).toContain('额度');
    expect(recoveryHint('network connection lost')).toContain('网络');
    expect(recoveryHint('audio device disconnected')).toContain('系统默认');
    expect(recoveryHint('timed out')).toContain('响应较慢');
  });
  it('keeps unknown error advice useful without displaying the raw response', () => {
    expect(recoveryHint('opaque server response')).toContain('诊断日志');
    expect(recoveryHint('opaque server response')).not.toContain('opaque');
  });
});
