import { describe, expect, it } from 'vitest';
import { configurationSection } from './configuration-guidance';

describe('configuration shortcuts', () => {
  it('points service validation to the corresponding settings section', () => {
    expect(configurationSection('请输入模型 ID。 请到设置页完善语音合成服务。')).toBe('tts');
    expect(configurationSection('Error: 请输入 API 地址。 请到设置页完善文字翻译服务。')).toBe(
      'translation',
    );
    expect(configurationSection('请到设置页完善语音识别服务。')).toBe('asr');
  });
  it('links device recovery to audio settings without guessing generic service errors', () => {
    expect(configurationSection('输出设备已断开，请刷新并重新选择。')).toBe('general');
    expect(configurationSection('麦克风不可用，请在设置中重新选择。')).toBe('general');
    expect(configurationSection('系统当前没有默认输出设备，请连接耳机或扬声器。')).toBe('general');
    for (const message of ['网络超时', '密钥无效', '余额不足', '已保存', '播放完成'])
      expect(configurationSection(message)).toBeNull();
  });
});
