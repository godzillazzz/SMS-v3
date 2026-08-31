import { useEffect, useRef } from 'react';
import { SmsIcon } from '../SmsIcon';
import { acquireDocumentScrollLock } from '../../document-scroll-lock';
import type { PersonnelRecord } from './types';

type Props = {
  employee?: PersonnelRecord;
  canManage: boolean;
  onClose(): void;
  onEdit(): void;
};

export function PersonnelDetailDrawer({ employee, canManage, onClose, onEdit }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!employee) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseScrollLock = acquireDocumentScrollLock();
    const timer = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 0);
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', handler);
      releaseScrollLock();
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [employee, onClose]);

  if (!employee) return null;
  const fullName = `${employee.firstName} ${employee.lastName}`.trim();
  const initials = fullName.split(/\s+/).filter(Boolean).map((value) => value[0]).join('').slice(0, 2) || 'SM';

  return <div className="personnel-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={drawerRef} className="personnel-detail-drawer operational-drawer" role="dialog" aria-modal="true" aria-labelledby="personnel-drawer-title">
      <header className="personnel-drawer-header">
        <div className="personnel-drawer-identity">
          <span className="personnel-drawer-avatar" aria-hidden="true">{initials}</span>
          <div><p>ข้อมูลพนักงาน</p><h2 id="personnel-drawer-title">{fullName || 'พนักงาน'}</h2><div className="personnel-drawer-context"><span>รหัสภายใน {employee.employeeCode}</span><span className={`status-badge ${employee.isActive ? 'status-badge--success active' : 'status-badge--neutral inactive'}`}>{employee.isActive ? 'ใช้งาน' : 'ไม่ใช้งาน'}</span></div></div>
        </div>
        <button ref={closeRef} type="button" className="personnel-drawer-close overlay-close" aria-label="ปิดรายละเอียดพนักงาน" onClick={onClose}><SmsIcon name="close" size={20} /></button>
      </header>
      <div className="personnel-drawer-content">
        <section className="personnel-detail-section" aria-labelledby="personnel-basic-title">
          <div className="personnel-section-heading"><span className="personnel-section-icon" aria-hidden="true"><SmsIcon name="employees" size={18} /></span><div><h3 id="personnel-basic-title">ข้อมูลบุคลากร</h3><p>ข้อมูลที่มีอยู่ใน Employee Master</p></div></div>
          <dl className="personnel-detail-grid">
            <div><dt>รหัสภายใน</dt><dd>{employee.employeeCode}</dd></div>
            <div><dt>ชื่อ</dt><dd>{employee.firstName || 'ไม่ระบุ'}</dd></div>
            <div><dt>นามสกุล</dt><dd>{employee.lastName || 'ไม่ระบุ'}</dd></div>
            <div><dt>หน่วยงาน</dt><dd>{employee.department || 'ไม่ระบุ'}</dd></div>
            <div className="personnel-detail-grid__wide"><dt>ตำแหน่ง</dt><dd>{employee.jobTitle || 'ไม่ระบุ'}</dd></div>
          </dl>
        </section>
        <section className="personnel-detail-section" aria-labelledby="personnel-status-title">
          <div className="personnel-section-heading"><span className="personnel-section-icon" aria-hidden="true"><SmsIcon name="shield" size={18} /></span><div><h3 id="personnel-status-title">สถานะการทำงาน</h3><p>สถานะที่ระบบส่งกลับสำหรับระเบียนนี้</p></div></div>
          <div className="personnel-employment-state"><span>สถานะปัจจุบัน</span><strong>{employee.isActive ? 'ใช้งาน' : 'ไม่ใช้งาน'}</strong><small>{employee.isActive ? 'ระเบียนพนักงานเปิดใช้งานอยู่' : 'ระเบียนพนักงานถูกทำเครื่องหมายว่าไม่ใช้งาน'}</small></div>
        </section>
      </div>
      {canManage && <footer className="personnel-drawer-actions">
        <button type="button" className="btn-primary personnel-drawer-primary" onClick={onEdit}><SmsIcon name="edit" size={17} />แก้ไขข้อมูล</button>
      </footer>}
    </aside>
  </div>;
}
