import { approvalBadgeText, approvalNotificationLabel } from './approval-count-badge';
import { SmsIcon } from './SmsIcon';

export function ApprovalCenterNotificationButton({ count, onClick }: { count: number | null; onClick(): void }) {
  const badge = approvalBadgeText(count);
  return <button type="button" className="topbar-notification-button" aria-label={approvalNotificationLabel(count)} title="คำขอที่รอการอนุมัติ" onClick={onClick}>
    <SmsIcon name="bell" size={19} />{badge && <span className="topbar-notification-badge">{badge}</span>}
  </button>;
}
