import type { ReactNode } from 'react';

export type DataTableStateVariant = 'loading' | 'empty' | 'error' | 'permission';

type DataTableStateProps = {
  variant: DataTableStateVariant;
  title: ReactNode;
  description?: ReactNode;
  action?: { label: string; onClick(): void };
  className?: string;
  announce?: boolean;
};

const stateIcons: Record<DataTableStateVariant, string> = {
  loading: '…',
  empty: '⌁',
  error: '!',
  permission: '⛨'
};

/** Shared state presentation for read-only operational data surfaces. */
export function DataTableState({ variant, title, description, action, className = '', announce = true }: DataTableStateProps) {
  const role = variant === 'error' ? 'alert' : 'status';
  return <div className={`data-table-state data-state data-state--${variant} ${className}`.trim()} role={announce ? role : undefined} aria-live={announce ? (variant === 'error' ? 'assertive' : 'polite') : undefined}>
    <span aria-hidden="true">{stateIcons[variant]}</span>
    <strong>{title}</strong>
    {description && <p>{description}</p>}
    {action && <button type="button" className="btn-neutral small-action" onClick={action.onClick}>{action.label}</button>}
  </div>;
}

type SkeletonRowsProps = { columnCount: number; rowCount?: number; rowClassName?: string };

/** Shared non-interactive table skeleton rows; caller owns the surrounding table semantics. */
export function DataTableSkeletonRows({ columnCount, rowCount = 5, rowClassName = '' }: SkeletonRowsProps) {
  return <>{Array.from({ length: rowCount }, (_, index) => <tr key={`data-table-skeleton-${index}`} className={`data-table-skeleton-row ${rowClassName}`.trim()} aria-hidden="true"><td colSpan={columnCount}><span className="data-table-skeleton-bar" /></td></tr>)}</>;
}

type SkeletonCardsProps = { count?: number; cardClassName?: string };

/** Shared mobile skeleton shape. Domain components supply the card class for existing styles. */
export function DataTableSkeletonCards({ count = 3, cardClassName = 'data-mobile-card' }: SkeletonCardsProps) {
  return <>{Array.from({ length: count }, (_, index) => <article key={`data-table-mobile-skeleton-${index}`} className={cardClassName} aria-hidden="true"><span className="data-table-skeleton-bar" /><span className="data-table-skeleton-bar" /><span className="data-table-skeleton-bar" /></article>)}</>;
}

export type ResponsiveDataTableProps = {
  ariaLabel: string;
  loading?: boolean;
  error?: boolean;
  loadingLabel?: ReactNode;
  errorLabel?: ReactNode;
  hasRows?: boolean;
  desktop: ReactNode;
  mobile?: ReactNode;
  className?: string;
  desktopClassName?: string;
  mobileClassName?: string;
};

/**
 * Minimal responsive data-surface contract. Table columns, row actions and domain
 * formatting remain page-owned; this component owns the shell, announcements and
 * desktop/mobile presentation boundary.
 */
export function ResponsiveDataTable({ ariaLabel, loading = false, error = false, loadingLabel = 'กำลังโหลดข้อมูล…', errorLabel = 'ไม่สามารถโหลดข้อมูล', desktop, mobile, className = '', desktopClassName = '', mobileClassName = '', }: ResponsiveDataTableProps) {
  const liveMessage = loading ? loadingLabel : error ? errorLabel : null;
  return <section className={`data-table-shell data-surface-card ${className}`.trim()} aria-label={ariaLabel} aria-busy={loading || undefined} data-table-has-mobile={mobile ? 'true' : undefined}>
    {liveMessage && <div className="data-table-live-region" role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}>{liveMessage}</div>}
    <div className={`data-table-desktop ${desktopClassName}`.trim()}>{desktop}</div>
    {mobile && <div className={`data-table-mobile ${mobileClassName}`.trim()}>{mobile}</div>}
  </section>;
}

export type DataTablePaginationProps = {
  page: number;
  totalPages: number;
  onChange(page: number): void;
  ariaLabel: string;
  loading?: boolean;
  className?: string;
};

/** Shared accessible pagination contract for server- and client-paginated tables. */
export function DataTablePagination({ page, totalPages, onChange, ariaLabel, loading = false, className = '' }: DataTablePaginationProps) {
  if (totalPages <= 1) return null;
  const previousDisabled = page <= 1 || loading;
  const nextDisabled = page >= totalPages || loading;
  return <nav className={`data-pagination ${className}`.trim()} aria-label={ariaLabel}>
    <button type="button" aria-label="หน้าก่อนหน้า" disabled={previousDisabled} onClick={() => onChange(page - 1)}>‹ ก่อนหน้า</button>
    <span aria-live="polite">หน้า {page} จาก {totalPages}</span>
    <button type="button" aria-label="หน้าถัดไป" disabled={nextDisabled} onClick={() => onChange(page + 1)}>หน้าถัดไป ›</button>
  </nav>;
}
