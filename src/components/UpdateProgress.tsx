import { t } from '../i18n';
import type { UpdateView } from '../core/app-update';

export function updateMessage(view: UpdateView) {
  switch (view.status) {
    case 'checking':
      return t('正在检查更新…');
    case 'downloading':
      return view.percent === null ? t('正在下载更新…') : t('正在下载更新… {0}%', view.percent);
    case 'waiting':
      return t('更新已下载，等待任务结束或保存更改。');
    case 'countdown':
      return t('更新已就绪，{0} 秒后安装并重启', view.seconds ?? 5);
    case 'installing':
      return t('正在安装更新，即将重新启动…');
    case 'latest':
      return t('当前已是最新版本。');
    default:
      return view.downloaded ? t('更新已下载，可安装并重启。') : t('发现新版本 {0}', view.version);
  }
}

export default function UpdateProgress({ view }: { view: UpdateView }) {
  if (!['downloading', 'waiting', 'countdown', 'installing'].includes(view.status)) return null;
  const percent =
    view.status === 'countdown' ? ((5 - (view.seconds ?? 5)) / 5) * 100 : view.percent;
  const indeterminate = percent === null || view.status === 'installing';
  return (
    <div
      className={`update-progress${indeterminate ? ' is-indeterminate' : ''}`}
      role="progressbar"
      aria-label={t('更新进度')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : percent}
    >
      <span style={{ width: indeterminate ? '35%' : `${percent}%` }} />
    </div>
  );
}
