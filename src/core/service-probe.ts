import type { ProviderProfile } from './types';
import { validateProfile } from './settings';
import { RequestTask } from './request-task';
type Dependencies = Pick<
  typeof import('../bridge'),
  'credentialStatus' | 'translate' | 'prepareSpeech' | 'discardPreparedSpeech'
>;
export async function probeService(
  profile: ProviderProfile,
  unsavedKey: boolean,
  id: string,
  task: RequestTask,
  deps: Dependencies,
): Promise<string> {
  const snapshot = structuredClone(profile);
  try {
    return await task.run(async () => {
      const invalid = validateProfile(snapshot);
      if (invalid) throw new Error(invalid);
      if (snapshot.adapter === 'pending_asr') throw new Error('请先选择语音识别协议。');
      if (unsavedKey) throw new Error('请先保存输入的密钥，再测试服务。');
      if (!(await deps.credentialStatus(snapshot.id)))
        throw new Error('请先保存此服务的 API 密钥。');
      if (!task.active) throw new Error('操作已取消。');
      if (snapshot.stage === 'translation') {
        const result = await deps.translate(snapshot, '你好', '简体中文', '英语', id);
        if (!result.trim()) throw new Error('翻译服务未返回有效译文，请重试或更换模型。');
        return '翻译测试通过，当前服务和模型可用。';
      }
      if (snapshot.stage === 'tts') {
        await deps.prepareSpeech({ ...snapshot, language: '英语' }, 'Hello.', id);
        return '语音生成测试通过，未播放或发送。';
      }
      return '配置与密钥已就绪；请在音频诊断中上传短音频验证识别。';
    }, 30000);
  } finally {
    if (snapshot.stage === 'tts') void deps.discardPreparedSpeech(id).catch(() => {});
  }
}
