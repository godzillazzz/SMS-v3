import { useId, type ReactNode } from 'react';
import type { LayoutHeadingProps } from './PageHeader';
export function SectionCard({ kicker, title, description, actions, children }: LayoutHeadingProps & { children: ReactNode }) {
  const titleId = useId();
  return <section className="layout-section-card" aria-labelledby={titleId}><header className="layout-section-card__heading"><div><p className="layout-kicker">{kicker}</p><h2 id={titleId}>{title}</h2><p>{description}</p></div>{actions && <div className="layout-actions">{actions}</div>}</header><div className="layout-section-card__content">{children}</div></section>;
}
