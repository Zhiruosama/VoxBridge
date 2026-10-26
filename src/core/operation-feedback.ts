import { errorKind } from './diagnostics';
export function recoveryHint(error: string): string {
  const hints = {
    auth: '请检查当前服务保存的密钥及账号权限。',
    rate_limit: '服务请求过于频繁，请稍等片刻再重试。',
    quota: '请检查服务账号的余额或可用额度。',
    timeout: '服务响应较慢，内容已保留，可稍后重试。',
    network: '请检查网络连接，恢复后可重试。',
    device: '请重新连接音频设备，或在音频设置中选择系统默认。',
    invalid_response: '模型没有返回有效结果，可重试或更换模型。',
    configuration: '请检查所选服务、模型和音色配置。',
    permission: '请检查系统权限，然后重试。',
    cancelled: '操作已取消。',
    unknown: '内容已保留，请重试；持续失败时可导出诊断日志。',
  };
  return hints[errorKind(error)];
}
