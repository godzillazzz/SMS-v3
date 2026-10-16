import { formatMetric } from './types';

type MetricCardProps = {
  icon: string;
  label: string;
  value?: number;
  context: string;
  tone: 'indigo' | 'green' | 'teal' | 'warning';
  loading?: boolean;
  unavailable?: boolean;
};

export function MetricCard({ icon, label, value, context, tone, loading, unavailable }: MetricCardProps) {
  return <article className={`dashboard-metric dashboard-metric--${tone}`}>
    <span className="dashboard-metric__icon" aria-hidden="true">{icon}</span>
    <div>
      <p>{label}</p>
      {loading ? <span className="dashboard-skeleton dashboard-skeleton--metric" aria-label="กำลังโหลด" /> : unavailable ? <strong aria-label="ข้อมูลไม่พร้อม">—</strong> : <strong>{formatMetric(value || 0)}</strong>}
      <small>{unavailable ? 'Data unavailable' : context}</small>
    </div>
  </article>;
}
