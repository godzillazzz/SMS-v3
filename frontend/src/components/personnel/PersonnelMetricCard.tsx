type Props = { label: string; value?: number; context: string; tone: 'indigo' | 'green' | 'amber' | 'blue'; icon: string };
import { Card, Icon } from '../ui/primitives';

export function PersonnelMetricCard({ label, value, context, tone, icon }: Props) {
  return <Card as="article" className={`personnel-metric personnel-metric--${tone}`}><Icon className="personnel-metric__icon">{icon}</Icon><div><p>{label}</p><strong>{value === undefined ? '—' : value}</strong><small>{context}</small></div></Card>;
}
