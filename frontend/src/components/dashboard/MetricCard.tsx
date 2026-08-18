import { SmsIcon, type SmsIconName } from '../SmsIcon';
import { formatMetric } from './types';

type MetricCardProps = {
  icon: SmsIconName;
  label: string;
  value?: number;
  context: string;
  tone: 'indigo' | 'green' | 'teal' | 'warning' | 'urgent';
  loading?: boolean;
  unavailable?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
};

export function MetricCard({ icon, label, value, context, tone, loading, unavailable, onClick, ariaLabel }: MetricCardProps) {
  const content = <>
    <span className="dashboard-metric__icon" aria-hidden="true"><SmsIcon name={icon} size={22} /></span>
    <div>
      <p>{label}</p>
      {loading ? <span className="dashboard-skeleton dashboard-skeleton--metric" aria-label="กำลังโหลด" /> : unavailable ? <strong aria-label="ข้อมูลไม่พร้อม">—</strong> : <strong>{formatMetric(value || 0)}</strong>}
      <small>{unavailable ? 'Data unavailable' : context}</small>
    </div>
  </>;
  return onClick ? <button type="button" className={`dashboard-metric dashboard-metric--${tone} dashboard-metric--interactive`} onClick={onClick} aria-label={ariaLabel || label}>{content}</button> : <article className={`dashboard-metric dashboard-metric--${tone}`}>{content}</article>;
}
