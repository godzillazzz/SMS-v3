import type { SmsIconName } from '../SmsIcon';
import { MetricCard } from '../layout';

type Props = { label: string; value?: number; context: string; loading?: boolean; tone: 'indigo' | 'green' | 'amber' | 'blue'; icon: SmsIconName };
export function PersonnelMetricCard({ label, value, context, loading = false, tone, icon }: Props) {
  return <MetricCard className={`personnel-metric personnel-metric--${tone}`} label={label} value={loading || value === undefined ? '—' : value} description={loading ? 'กำลังโหลด…' : context} icon={icon} loading={loading} />;
}
