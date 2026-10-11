import { useId, type ReactNode, type ComponentPropsWithoutRef } from 'react';
import type { LayoutHeadingProps } from './PageHeader';
export function SectionCard({ kicker, title, description, actions, children, className = '', ...attributes }: LayoutHeadingProps & { children: ReactNode } & Omit<ComponentPropsWithoutRef<'section'>, 'title' | 'children' | 'className'>) {
  const titleId = useId();
  return <section {...attributes} className={`layout-section-card ${className}`.trim()} aria-labelledby={attributes['aria-labelledby'] ?? (attributes['aria-label'] ? undefined : titleId)}><header className="layout-section-card__heading"><div><p className="layout-kicker">{kicker}</p><h2 id={titleId}>{title}</h2><p>{description}</p></div>{actions && <div className="layout-actions">{actions}</div>}</header><div className="layout-section-card__content">{children}</div></section>;
}
