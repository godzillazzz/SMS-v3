import type { ReactNode } from 'react';
export type LayoutHeadingProps = { kicker: string; title: string; description: string; actions?: ReactNode; className?: string; /** Visible lead line; when set the h1 keeps the page name for assistive tech. */ lead?: ReactNode };
export function PageHeader({ kicker, title, description, actions, className = '', lead }: LayoutHeadingProps) {
  return <header className={`layout-page-header ${className}`.trim()}><div><p className="layout-kicker">{kicker}</p><h1 className={lead ? 'sr-only' : undefined}>{title}</h1>{lead && <p className="layout-lead">{lead}</p>}<p>{description}</p></div>{actions && <div className="layout-actions">{actions}</div>}</header>;
}
