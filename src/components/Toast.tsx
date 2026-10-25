import { t } from '../i18n';
import { useEffect } from 'react';
import { Check, Info, X } from 'lucide-react';

export default function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  const saved =
    message === '已保存' || message.startsWith('密钥已保存') || message.includes('已删除');
  useEffect(() => {
    const timer = window.setTimeout(onClose, saved ? 3000 : 6000);
    return () => window.clearTimeout(timer);
  }, [onClose, saved]);
  return (
    <div className="toast-positioner">
      <div className="toast" role="status" aria-live="polite" aria-atomic="true">
        {saved ? <Check size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}
        <span>{t(message)}</span>
        <button className="icon-button" aria-label={t('关闭提示')} onClick={onClose}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
