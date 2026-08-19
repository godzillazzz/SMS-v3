import type { ReactNode } from 'react';

type HeaderProps = { label: string };
type CellProps = { children: ReactNode; className?: string; onClick?(event: React.MouseEvent<HTMLTableCellElement>): void };

export function TableActionHeader({ label }: HeaderProps) {
  return <th scope="col" className="data-action-column data-action-column--header"><span>{label}</span></th>;
}

export function TableActionCell({ children, className = '', onClick }: CellProps) {
  return <td className={`data-action-column data-action-column--cell ${className}`.trim()} onClick={onClick}><div className="data-action-group">{children}</div></td>;
}
