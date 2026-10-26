import { describe, expect, it, vi } from 'vitest';
import { probeService } from './service-probe';
import { RequestTask } from './request-task';
import { defaults, profileFor } from './settings';
function fixture(stage: 'translation' | 'tts' | 'asr' = 'translation') {
  const profile = {
    ...profileFor(defaults, stage),
    name: 'Test',
    baseUrl: stage === 'tts' ? 'wss://api.minimax.cn/ws/v1/t2a_v2' : 'https://example.com',
    modelId: 'test',
    voice: 'test',
    adapter: (stage === 'asr'
      ? 'qwen_chat_asr'
      : stage === 'tts'
        ? 'minimax_tts_ws'
        : 'openai_chat_completions') as (typeof defaults.profiles)[number]['adapter'],
  };
  const deps = {
    credentialStatus: vi.fn(async () => true),
    translate: vi.fn(async () => 'Hello'),
    prepareSpeech: vi.fn(async () => {}),
    discardPreparedSpeech: vi.fn(async () => {}),
  };
  const task = new RequestTask(async () => {});
  return { profile, deps, task };
}
describe('explicit service checks', () => {
  it('tests translation using only the translation service', async () => {
    const { profile, deps, task } = fixture();
    expect(await probeService(profile, false, 'test', task, deps)).toContain('翻译测试通过');
    expect(deps.translate).toHaveBeenCalledWith(profile, '你好', '简体中文', '英语', 'test');
    expect(deps.prepareSpeech).not.toHaveBeenCalled();
  });
  it('only prepares speech and discards it without playback or device routing', async () => {
    const { profile, deps, task } = fixture('tts');
    expect(await probeService(profile, false, 'test', task, deps)).toContain('未播放');
    expect(deps.prepareSpeech).toHaveBeenCalledTimes(1);
    expect(deps.discardPreparedSpeech).toHaveBeenCalledWith('test');
  });
  it('does not spend a request on missing or unsaved credentials', async () => {
    const { profile, deps, task } = fixture();
    await expect(probeService(profile, true, 'test', task, deps)).rejects.toThrow('先保存');
    expect(deps.translate).not.toHaveBeenCalled();
    deps.credentialStatus.mockResolvedValue(false);
    await expect(
      probeService(profile, false, 'test', new RequestTask(async () => {}), deps),
    ).rejects.toThrow('密钥');
    expect(deps.translate).not.toHaveBeenCalled();
  });
  it('does not claim live ASR availability from a local configuration check', async () => {
    const { profile, deps, task } = fixture('asr');
    expect(await probeService(profile, false, 'test', task, deps)).toContain('短音频验证');
    expect(deps.translate).not.toHaveBeenCalled();
    expect(deps.prepareSpeech).not.toHaveBeenCalled();
  });
  it('does not start a paid request if cancelled while checking the key', async () => {
    const { profile, deps, task } = fixture();
    let resolve!: (value: boolean) => void;
    deps.credentialStatus.mockReturnValue(
      new Promise((yes) => {
        resolve = yes;
      }),
    );
    const request = probeService(profile, false, 'test', task, deps);
    const rejected = expect(request).rejects.toThrow('取消');
    task.cancel();
    await rejected;
    resolve(true);
    await Promise.resolve();
    expect(deps.translate).not.toHaveBeenCalled();
  });
});
