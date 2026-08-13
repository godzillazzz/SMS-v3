import { useEffect, useRef, useState } from 'react';
import type { PersonnelRecord, PersonnelRole } from './types';

type Props = { employee?: PersonnelRecord; canManage: boolean; role: PersonnelRole; onClose(): void; onEdit(): void; onLifecycle(): void };

export function PersonnelDetailDrawer({ employee, canManage, role, onClose, onEdit, onLifecycle }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState('overview');
  useEffect(() => {
    if (!employee) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    setTab('overview');
    closeRef.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); document.body.style.overflow = previousBodyOverflow; document.documentElement.style.overflow = previousDocumentOverflow; previous?.focus(); };
  }, [employee, onClose]);
  if (!employee) return null;
  const fullName = `${employee.firstName} ${employee.lastName}`.trim();
  const tabs = [['overview', 'ภาพรวม'], ['employment', 'การทำงาน'], ['organization', 'หน่วยงาน'], ['access', 'สิทธิ์และบทบาท'], ['audit', 'ประวัติการตรวจสอบ']];
  return <div className="personnel-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside ref={drawerRef} className="personnel-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="personnel-drawer-title"><header className="personnel-drawer-header"><div className="personnel-drawer-identity"><span className="personnel-drawer-avatar" aria-hidden="true">{fullName.split(/\s+/).map((value) => value[0]).join('').slice(0, 2) || 'SM'}</span><div><p>PERSONNEL PROFILE</p><h2 id="personnel-drawer-title">{fullName || 'พนักงาน'}</h2><span>{employee.employeeCode}</span></div></div><button ref={closeRef} type="button" className="personnel-drawer-close" aria-label="ปิดรายละเอียดพนักงาน" onClick={onClose}>×</button></header><div className="personnel-drawer-tabs" role="tablist">{tabs.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>)}</div><section className="personnel-drawer-content"><h3>{tabs.find(([value]) => value === tab)?.[1]}</h3>{tab === 'overview' && <dl className="personnel-detail-grid"><div><dt>รหัสพนักงาน</dt><dd>{employee.employeeCode}</dd></div><div><dt>สถานะ</dt><dd>{employee.isActive ? 'ใช้งาน' : 'ไม่ใช้งาน'}</dd></div><div><dt>หน่วยงาน</dt><dd>{employee.department || 'ไม่ระบุ'}</dd></div><div><dt>ตำแหน่ง</dt><dd>{employee.jobTitle || 'ไม่ระบุ'}</dd></div></dl>}{tab !== 'overview' && <div className="personnel-drawer-empty"><span>◌</span><b>ข้อมูลประวัติวงจรพนักงานเปิดจากปุ่มด้านล่าง</b><small>ประวัติการเปลี่ยนแปลงเป็นข้อมูลอ่านอย่างเดียว</small></div>}</section><footer className="personnel-drawer-actions"><button type="button" className="btn-neutral small-action" onClick={onClose}>ปิด</button>{canManage && <button type="button" className="btn-neutral small-action" onClick={onEdit}>ข้อมูลทั่วไป</button>}{role === 'ADMIN' && <button type="button" className="btn-primary compact" onClick={onLifecycle}>จัดการวงจรพนักงาน</button>}</footer></aside></div>;
}
