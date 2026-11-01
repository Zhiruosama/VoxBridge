import Toast from './Toast';
import UpdatePrompt from './UpdatePrompt';

/** Independent notices share one stack; a regular toast must never hide update progress. */
export default function AppNotices({
  message,
  noticeId,
  onClose,
  onConfigure,
}: {
  message: string;
  noticeId: number;
  onClose: () => void;
  onConfigure?: () => void;
}) {
  return (
    <div className="app-notice-stack">
      {message && (
        <Toast key={noticeId} message={message} onClose={onClose} onConfigure={onConfigure} />
      )}
      <UpdatePrompt />
    </div>
  );
}
