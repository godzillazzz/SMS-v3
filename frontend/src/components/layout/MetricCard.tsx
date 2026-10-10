import { useId, type ReactNode } from 'react';
import { SmsIcon, type SmsIconName } from '../SmsIcon';
export function MetricCard({ label, value, description, icon }: { label: string; value: ReactNode; description: string; icon?: SmsIconName }) {
  const labelId = useId();
  return <section className="layout-metric-card" aria-labelledby={labelId}>{icon && <SmsIcon name={icon} />}<h2 id={labelId}>{label}</h2><strong className="layout-metric-card__value">{value}</strong><p>{description}</p></section>;
}
