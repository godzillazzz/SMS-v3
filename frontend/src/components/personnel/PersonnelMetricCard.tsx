type Props = { label: string; value?: number; context: string; tone: 'indigo' | 'green' | 'amber' | 'blue'; icon: string };
export function PersonnelMetricCard({ label, value, context, tone, icon }: Props) {
  return <article className={`personnel-metric personnel-metric--${tone}`}><span className="personnel-metric__icon" aria-hidden="true">{icon}</span><div><p>{label}</p><strong>{value === undefined ? '—' : value}</strong><small>{context}</small></div></article>;
}
