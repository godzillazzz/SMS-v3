import { useId } from 'react';
import { SmsIcon, type SmsIconName } from '../SmsIcon';
export type LayoutStep = { id: string; icon: SmsIconName; label: string; title: string; desc: string; onClick?: () => void; completed?: boolean; current?: boolean; disabled?: boolean };
export function StepFlow({ steps, title = 'ทำงานต่อจากตรงนี้', description }: { steps: readonly LayoutStep[]; title?: string; description: string }) {
  const titleId = useId();
  return <section className="layout-step-flow" aria-labelledby={titleId}><p className="layout-kicker">ลำดับการทำงาน</p><h2 id={titleId}>{title}</h2><p>{description}</p><ol className="layout-step-flow__steps">{steps.map(step => <li key={step.id} aria-current={step.current ? 'step' : undefined}><button type="button" onClick={step.onClick} disabled={step.disabled || !step.onClick}><SmsIcon name={step.completed ? 'check' : step.icon} /><span><small>{step.label}</small><strong>{step.title}</strong><span>{step.desc}</span>{step.completed && <span className="layout-step-status">เสร็จแล้ว</span>}</span></button></li>)}</ol></section>;
}
