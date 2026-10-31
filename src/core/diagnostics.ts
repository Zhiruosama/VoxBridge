export type ErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'quota'
  | 'timeout'
  | 'network'
  | 'permission'
  | 'device'
  | 'invalid_response'
  | 'configuration'
  | 'cancelled'
  | 'unknown';
export type DiagnosticEvent = {
  operation: string;
  kind: 'start' | 'finish' | 'error' | 'state';
  traceId?: string;
  correlationId?: string;
  durationMs?: number;
  reason?: ErrorKind;
  phase?: string;
  attempt?: number;
  adapter?: string;
  count?: number;
  failedCount?: number;
  queued?: number;
  inflight?: number;
};
export function correlationId(value: unknown): string | undefined {
  return typeof value === 'string' &&
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}(?::\d{1,6})?$/i.test(value)
    ? value
    : undefined;
}
/** Classify for diagnostics only. Never return or stringify provider/user content. */
export function errorKind(error: unknown): ErrorKind {
  const message = (
    typeof error === 'string' ? error : error instanceof Error ? error.message : ''
  ).slice(0, 4000);
  if (/取消|停止|cancel|abort/i.test(message)) return 'cancelled';
  if (/权限|授权|permission|denied/i.test(message)) return 'permission';
  if (/401|403|密钥|认证|unauthori|api.?key|authentic/i.test(message)) return 'auth';
  if (/429|频率|限流|rate.?limit/i.test(message)) return 'rate_limit';
  if (/余额|额度|quota|credits?|insufficient/i.test(message)) return 'quota';
  if (/超时|timeout|timed out/i.test(message)) return 'timeout';
  if (/设备|采集|进程|麦克风|device|capture|microphone/i.test(message)) return 'device';
  if (/未返回有效|空内容|空译文|无效译文|invalid.*response|empty/i.test(message))
    return 'invalid_response';
  if (/配置|模型|音色|configuration|model|voice/i.test(message)) return 'configuration';
  if (/网络|连接|中断|network|connect|socket/i.test(message)) return 'network';
  return 'unknown';
}

export function adapterCode(value: unknown): string | undefined {
  return typeof value === 'string' &&
    [
      'openai_chat_completions',
      'minimax_tts_ws',
      'openai_audio_speech',
      'qwen_chat_asr',
      'openai_audio_transcriptions',
      'qwen_dashscope_asr',
      'pending_asr',
    ].includes(value)
    ? value
    : undefined;
}
