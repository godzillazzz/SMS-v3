import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

type ClassValue = string | false | undefined;
const cx = (...values: ClassValue[]) => values.filter(Boolean).join(' ');

export type ButtonVariant = 'primary' | 'secondary' | 'info' | 'info-outline' | 'info-soft' | 'success' | 'warning' | 'danger' | 'neutral' | 'ghost';
export type ButtonSize = 'default' | 'small' | 'compact' | 'icon';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant, size = 'default', isLoading = false, disabled, className, type = 'button', children, ...props }, ref) {
  return <button
    {...props}
    ref={ref}
    type={type}
    disabled={disabled || isLoading}
    aria-busy={isLoading || undefined}
    className={cx('ui-button', variant && `btn-${variant}`, size === 'small' && 'ui-button--small small-action', size === 'compact' && 'ui-button--compact compact', size === 'icon' && 'ui-button--icon btn-icon-only', className)}
  >{children}</button>;
});

export type IconProps = HTMLAttributes<HTMLSpanElement> & { label?: string };
export function Icon({ label, className, children, ...props }: IconProps) {
  return <span {...props} className={cx('ui-icon', className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>{children}</span>;
}

export type FieldProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  labelClassName?: string;
  children: ReactNode;
};

export function Field({ label, htmlFor, hint, error, required = false, labelClassName, className, children, ...props }: FieldProps) {
  return <div {...props} className={cx('ui-field', className)}>
    <label className={cx('ui-field__label', labelClassName)} htmlFor={htmlFor}>
      {label}{required && <span className="ui-field__required" aria-hidden="true"> *</span>}
    </label>
    {children}
    {hint && <small className="ui-field__hint">{hint}</small>}
    {error && <small className="ui-field__error" role="alert">{error}</small>}
  </div>;
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...props }, ref) {
  return <input {...props} ref={ref} className={cx('ui-input', className)} />;
});

export function SelectInput({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx('ui-select', className)}>{children}</select>;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx('ui-textarea', className)} />;
}

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'violet';
export type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; icon?: ReactNode };
export function Badge({ tone = 'neutral', icon, className, children, ...props }: BadgeProps) {
  return <span {...props} className={cx('ui-badge', `ui-badge--${tone}`, className)}>
    {icon !== undefined && <Icon className="ui-badge__icon">{icon}</Icon>}
    <span className="ui-badge__label">{children}</span>
  </span>;
}

const statusToneByValue: Record<Exclude<BadgeTone, 'violet'>, ReadonlySet<string>> = {
  success: new Set(['ACTIVE', 'APPROVED', 'MATCHED', 'DUPLICATE_MATCHED', 'VALID', 'ENABLED', 'PASS', 'PASSED', 'SUCCESS', 'COMPLETED']),
  warning: new Set(['PENDING', 'UNMATCHED', 'DUPLICATE_UNMATCHED', 'WARNING', 'REVIEW', 'PASSWORD_RESET_REQUIRED']),
  danger: new Set(['SUSPENDED', 'REJECTED', 'REVOKED', 'INACTIVE', 'EXPIRED', 'MISSING', 'INVALID', 'ERROR', 'FAILED', 'DISABLED', 'CRITICAL']),
  info: new Set(['INFO', 'INFORMATION', 'MANAGER']),
  neutral: new Set(['VIEWER', 'CANCELLED', 'CANCELED', 'CLOSED', 'UNKNOWN']),
};

const statusToneIcon: Record<BadgeTone, string> = {
  success: '✓', warning: '!', danger: '×', info: 'i', neutral: '•', violet: '♙',
};

export function statusBadgeTone(value: unknown): BadgeTone {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'ADMIN') return 'violet';
  return (Object.entries(statusToneByValue).find(([, values]) => values.has(normalized))?.[0] as BadgeTone | undefined) || 'neutral';
}

export type StatusBadgeProps = Omit<BadgeProps, 'tone' | 'icon'> & { value: unknown };
export function StatusBadge({ value, className, children, ...props }: StatusBadgeProps) {
  const tone = statusBadgeTone(value);
  return <Badge {...props} tone={tone} icon={statusToneIcon[tone]} className={className}>{children ?? String(value ?? '—')}</Badge>;
}

export type CardProps = HTMLAttributes<HTMLElement> & { as?: 'div' | 'article' | 'section' };
export function Card({ as: Element = 'div', className, children, ...props }: CardProps) {
  const classes = cx('ui-card', className);
  if (Element === 'article') return <article {...props} className={classes}>{children}</article>;
  if (Element === 'section') return <section {...props} className={classes}>{children}</section>;
  return <div {...props} className={classes}>{children}</div>;
}

export type AlertProps = HTMLAttributes<HTMLDivElement> & { tone?: BadgeTone; live?: 'polite' | 'assertive' };
export function Alert({ tone = 'info', live = 'polite', className, role, children, ...props }: AlertProps) {
  return <div {...props} className={cx('ui-alert', `ui-alert--${tone}`, className)} role={role || 'status'} aria-live={live}>{children}</div>;
}

export type ToastProps = HTMLAttributes<HTMLDivElement> & { live?: 'polite' | 'assertive' };
export function Toast({ live = 'polite', className, role, children, ...props }: ToastProps) {
  return <div {...props} className={cx('ui-toast', className)} role={role || 'status'} aria-live={live}>{children}</div>;
}

export type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
};
export function EmptyState({ icon, title, description, className, children, role, ...props }: EmptyStateProps) {
  return <div {...props} className={cx('ui-empty-state', className)} role={role || 'status'} aria-live={props['aria-live'] || 'polite'}>
    <Icon>{icon}</Icon>
    <h2>{title}</h2>
    {description && <p>{description}</p>}
    {children}
  </div>;
}

export type DataTableProps = HTMLAttributes<HTMLTableElement> & {
  scrollClassName?: string;
  caption?: ReactNode;
};
export function DataTable({ scrollClassName, caption, className, children, ...props }: DataTableProps) {
  return <div className={cx('ui-table-scroll', scrollClassName)}>
    <table {...props} className={cx('ui-table', className)}>
      {caption && <caption className="ui-visually-hidden">{caption}</caption>}
      {children}
    </table>
  </div>;
}

export type PaginationProps = {
  page: number;
  totalPages: number;
  onChange(page: number): void;
  label: string;
  previousLabel?: ReactNode;
  nextLabel?: ReactNode;
  pageLabel?: (page: number, totalPages: number) => ReactNode;
  disabled?: boolean;
  className?: string;
};

export function Pagination({ page, totalPages, onChange, label, previousLabel = '‹ ก่อนหน้า', nextLabel = 'หน้าถัดไป ›', pageLabel, disabled = false, className }: PaginationProps) {
  if (totalPages <= 1) return null;
  return <nav className={cx('ui-pagination', className)} aria-label={label}>
    <Button variant="neutral" size="small" aria-label="หน้าก่อนหน้า" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>{previousLabel}</Button>
    <span>{pageLabel ? pageLabel(page, totalPages) : `หน้า ${page} จาก ${totalPages}`}</span>
    <Button variant="neutral" size="small" aria-label="หน้าถัดไป" disabled={disabled || page >= totalPages} onClick={() => onChange(page + 1)}>{nextLabel}</Button>
  </nav>;
}

export type DialogSurfaceProps = Omit<HTMLAttributes<HTMLElement>, 'role'> & { labelledBy: string; modal?: boolean };
export const DialogSurface = forwardRef<HTMLElement, DialogSurfaceProps>(function DialogSurface({ labelledBy, modal = true, className, children, ...props }, ref) {
  return <aside {...props} ref={ref} className={cx('ui-dialog-surface', className)} role="dialog" aria-modal={modal} aria-labelledby={labelledBy}>{children}</aside>;
});
