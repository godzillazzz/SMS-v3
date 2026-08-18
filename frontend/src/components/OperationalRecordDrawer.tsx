import { useEffect, useRef, type ReactNode } from 'react';
import { SmsIcon, type SmsIconName } from './SmsIcon';

export type OperationalDrawerAction = {
  label: string;
  onSelect(): void;
  tone?: 'primary' | 'secondary' | 'danger';
  icon?: SmsIconName;
};

type OperationalRecordDrawerProps = {
  open: boolean;
  eyebrow: string;
  title: string;
  subtitle?: string;
  status?: ReactNode;
  fields: Array<{ label: string; value: ReactNode }>;
  primaryAction?: OperationalDrawerAction;
  secondaryActions?: OperationalDrawerAction[];
  onClose(): void;
};

const actionClass = (tone: OperationalDrawerAction['tone']) => tone === 'danger' ? 'btn-danger' : tone === 'secondary' ? 'btn-neutral' : 'btn-primary';

export function OperationalRecordDrawer({ open, eyebrow, title, subtitle, status, fields, primaryAction, secondaryActions = [], onClose }: OperationalRecordDrawerProps) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    const timer = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return <div className="signature-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={drawerRef} className="signature-record-drawer operational-drawer" role="dialog" aria-modal="true" aria-labelledby="signature-record-drawer-title">
      <header className="signature-record-drawer__header">
        <div className="signature-record-drawer__identity">
          <span className="signature-record-drawer__icon" aria-hidden="true"><SmsIcon name="eye" size={20} /></span>
          <div>
            <p>{eyebrow}</p>
            <h2 id="signature-record-drawer-title">{title}</h2>
            {subtitle && <span>{subtitle}</span>}
          </div>
        </div>
        <button ref={closeRef} type="button" className="drawer-close overlay-close" aria-label="ปิดรายละเอียด" onClick={onClose}><SmsIcon name="close" size={20} /></button>
      </header>
      <div className="signature-record-drawer__body">
        {status && <div className="signature-record-drawer__status">{status}</div>}
        <section className="signature-record-drawer__section" aria-label="รายละเอียดรายการ">
          <div className="signature-record-drawer__section-heading"><h3>รายละเอียด</h3><p>ข้อมูลสำคัญของรายการที่เลือก</p></div>
          <dl className="signature-record-drawer__fields">
            {fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}
          </dl>
        </section>
      </div>
      {(primaryAction || secondaryActions.length > 0) && <footer className="signature-record-drawer__actions">
        {primaryAction && <button type="button" className={actionClass(primaryAction.tone)} onClick={primaryAction.onSelect}>{primaryAction.icon && <SmsIcon name={primaryAction.icon} size={17} />}{primaryAction.label}</button>}
        {secondaryActions.map((action) => <button type="button" key={action.label} className={actionClass(action.tone || 'secondary')} onClick={action.onSelect}>{action.icon && <SmsIcon name={action.icon} size={17} />}{action.label}</button>)}
      </footer>}
    </aside>
  </div>;
}
