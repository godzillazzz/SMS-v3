import type { ReactNode } from 'react';
export type LayoutHeadingProps = { kicker: string; title: string; description: string; actions?: ReactNode; className?: string };
export function PageHeader({ kicker, title, description, actions, className = '' }: LayoutHeadingProps) {
  return <header className={`layout-page-header ${className}`.trim()}><div><p className="layout-kicker">{kicker}</p><h1>{title}</h1><p>{description}</p></div>{actions && <div className="layout-actions">{actions}</div>}</header>;
}
