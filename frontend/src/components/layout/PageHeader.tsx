import type { ReactNode } from 'react';
export type LayoutHeadingProps = { kicker: string; title: string; description: string; actions?: ReactNode };
export function PageHeader({ kicker, title, description, actions }: LayoutHeadingProps) {
  return <header className="layout-page-header"><div><p className="layout-kicker">{kicker}</p><h1>{title}</h1><p>{description}</p></div>{actions && <div className="layout-actions">{actions}</div>}</header>;
}
