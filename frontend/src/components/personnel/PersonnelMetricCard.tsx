import { SmsIcon, type SmsIconName } from '../SmsIcon';

type Props = { label: string; value?: number; context: string; loading?: boolean; tone: 'indigo' | 'green' | 'amber' | 'blue'; icon: SmsIconName };
export function PersonnelMetricCard({ label, value, context, loading = false, tone, icon }: Props) {
  return <article className={`personnel-metric personnel-metric--${tone}`} aria-busy={loading || undefined}><span className="personnel-metric__icon" aria-hidden="true"><SmsIcon name={icon} size={19} /></span><div><p>{label}</p><strong>{loading || value === undefined ? '—' : value}</strong><small>{loading ? 'กำลังโหลด…' : context}</small></div></article>;
}
