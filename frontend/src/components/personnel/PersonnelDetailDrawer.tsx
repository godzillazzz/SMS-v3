import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { acquireDocumentScrollLock } from '../../document-scroll-lock';
import { SmsIcon } from '../SmsIcon';
import type { PersonnelRecord } from './types';

type Props = {
  employee?: PersonnelRecord;
  token?: string;
  canManage: boolean;
  onClose(): void;
  onEdit(): void;
};

type ChangeRequest = { id: string; status: string; draftEffectiveMode?: string; draftEffectiveDate?: string | null; draftProposal?: Record<string, unknown> | null; draftReason?: string | null };
type LifecycleEvent = { id: string; type: string; status: 'PENDING' | 'APPLIED'; effectiveDate: string; reason: string; createdAt: string; oldValue?: { employee?: Record<string, unknown> }; newValue?: { employee?: Record<string, unknown> }; changedBy?: { displayName?: string; role?: string } };
type ReferenceState = { activePhoto?: { id: string; activatedAt?: string | null } | null; pendingPhoto?: { id: string; uploadedAt?: string | null } | null };
type AccountState = { id: string; employeeId?: string | null; accountStatus?: string; isActive?: boolean; role?: string };
type LicenseState = { id: string; employeeId?: string | null; licenseType?: string; expiryDate?: string | null; status?: string };
type OnboardingReadiness = { status: 'READY' | 'NOT_READY'; checks: Record<string, { ready: boolean; [key: string]: unknown }>; blockers: Array<{ code: string; label: string; detail: string }> };

const activeRequestStatuses = new Set(['DRAFT', 'PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION']);
const requestStatusLabel: Record<string, string> = { DRAFT: 'ฉบับร่าง', PENDING_APPROVAL: 'รอ Admin อนุมัติ', RETURNED_FOR_CORRECTION: 'ส่งกลับให้แก้ไข' };
const lifecycleLabel: Record<string, string> = { NAME_CHANGE: 'เปลี่ยนชื่อ', DEPARTMENT_TRANSFER: 'ย้ายหน่วยงาน', POSITION_CHANGE: 'เปลี่ยนตำแหน่ง', EMPLOYMENT_TERMINATION: 'ลาออก', REHIRE: 'กลับเข้าทำงาน', MASTER_EDIT: 'แก้ไขข้อมูลพนักงาน' };
const fieldLabel: Record<string, string> = { firstName: 'ชื่อ', lastName: 'นามสกุล', department: 'หน่วยงาน', jobTitle: 'ตำแหน่ง', isActive: 'สถานะ', email: 'อีเมล', phone: 'โทรศัพท์', hiredAt: 'วันที่เริ่มงาน', skill: 'ทักษะ/คุณสมบัติ' };
const fmtDate = (value?: string | null) => value ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(value)) : '—';
const fmtDateTime = (value?: string | null) => value ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value)) : '—';
const valueText = (field: string, value: unknown) => field === 'isActive' ? (value === true ? 'ปฏิบัติงาน' : 'ลาออก') : value === null || value === undefined || value === '' ? '—' : String(value);
const accountReady = (account?: AccountState) => Boolean(account && account.accountStatus === 'ACTIVE' && account.isActive !== false);


function eventChange(event: LifecycleEvent) {
  const before = event.oldValue?.employee || {};
  const after = event.newValue?.employee || {};
  const changed = Object.keys(fieldLabel).filter((field) => String(before[field] ?? '') !== String(after[field] ?? ''));
  if (!changed.length) return lifecycleLabel[event.type] || event.type;
  return changed.slice(0, 3).map((field) => `${fieldLabel[field] || field}: ${valueText(field, before[field])} → ${valueText(field, after[field])}`).join(' · ');
}

export function PersonnelDetailDrawer({ employee, token, canManage, onClose, onEdit }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [history, setHistory] = useState<LifecycleEvent[]>([]);
  const [reference, setReference] = useState<ReferenceState>();
  const [account, setAccount] = useState<AccountState>();
  const [licenses, setLicenses] = useState<LicenseState[]>([]);
  const [onboardingReadiness, setOnboardingReadiness] = useState<OnboardingReadiness>();
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusUnavailable, setStatusUnavailable] = useState(false);

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
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', handler); releaseScrollLock(); previouslyFocused?.focus({ preventScroll: true }); };
  }, [employee, onClose]);

  useEffect(() => {
    if (!employee || !token) { setRequests([]); setHistory([]); setReference(undefined); setAccount(undefined); setLicenses([]); setOnboardingReadiness(undefined); setStatusUnavailable(false); return; }
    let active = true;
    setStatusLoading(true); setStatusUnavailable(false);
    Promise.allSettled([api.employeeChangeRequests(token, employee.id), api.employeeLifecycleHistory(token, employee.id, 1), api.employeeReferencePhotos(token, employee.id), api.users(token), api.licenses(token, 1), api.employeeOnboardingReadiness(token, employee.id)]).then((results) => {
      if (!active) return;
      const [requestResult, historyResult, photoResult, userResult, licenseResult, readinessResult] = results;
      if (requestResult.status === 'fulfilled') setRequests(Array.isArray(requestResult.value?.data) ? requestResult.value.data as ChangeRequest[] : []);
      if (historyResult.status === 'fulfilled') setHistory(Array.isArray(historyResult.value?.data) ? historyResult.value.data as LifecycleEvent[] : []);
      if (photoResult.status === 'fulfilled') setReference((photoResult.value?.data || {}) as ReferenceState);
      if (userResult.status === 'fulfilled') { const rows = Array.isArray(userResult.value?.data) ? userResult.value.data as AccountState[] : []; setAccount(rows.find((row) => String(row.employeeId || '') === employee.id)); }
      if (licenseResult.status === 'fulfilled') { const rows = Array.isArray(licenseResult.value?.data) ? licenseResult.value.data as LicenseState[] : []; setLicenses(rows.filter((row) => String(row.employeeId || '') === employee.id)); }
      if (readinessResult.status === 'fulfilled') setOnboardingReadiness((readinessResult.value?.data || undefined) as OnboardingReadiness | undefined);
      setStatusUnavailable(results.every((result) => result.status === 'rejected'));
    }).finally(() => { if (active) setStatusLoading(false); });
    return () => { active = false; };
  }, [employee?.id, token]);

  const activeRequest = useMemo(() => requests.find((request) => activeRequestStatuses.has(request.status)), [requests]);
  const pendingLifecycle = useMemo(() => history.find((event) => event.status === 'PENDING'), [history]);
  const activeLicenses = useMemo(() => licenses.filter((license) => license.status === 'Active'), [licenses]);
  const expiringLicense = useMemo(() => activeLicenses.filter((license) => { if (!license.expiryDate) return false; const days = (new Date(license.expiryDate).getTime() - Date.now()) / 86400000; return days >= 0 && days <= 30; }).sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)))[0], [activeLicenses]);
  const readiness = useMemo(() => {
    if (statusLoading) return { label: 'กำลังตรวจสอบ…', tone: 'neutral', detail: 'กำลังอ่านสถานะจาก authority ฝั่ง server' };
    if (!onboardingReadiness) return { label: 'ตรวจสอบไม่ได้', tone: 'warning', detail: 'Onboarding readiness authority ไม่พร้อม จึงไม่คาดเดาสถานะจาก client' };
    if (onboardingReadiness.status === 'READY') return { label: 'พร้อมลงเวลา', tone: 'success', detail: 'Employee, Account, Reference Photo, Schedule, Shift, Security Site และ cryptographic Attendance Device ผ่าน authority ที่กำหนด' };
    return { label: 'ยังไม่พร้อมลงเวลา', tone: 'warning', detail: onboardingReadiness.blockers.map((item) => item.detail).join(' · ') || 'มี prerequisite ที่ยังไม่ผ่าน' };
  }, [statusLoading, onboardingReadiness]);
  if (!employee) return null;
  const fullName = `${employee.firstName} ${employee.lastName}`.trim();
  const initials = fullName.split(/\s+/).filter(Boolean).map((value) => value[0]).join('').slice(0, 2) || 'SM';

  return <div className="personnel-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={drawerRef} className="personnel-detail-drawer personnel-detail-drawer--360 operational-drawer" role="dialog" aria-modal="true" aria-labelledby="personnel-drawer-title">
      <header className="personnel-drawer-header personnel-360-header">
        <div className="personnel-drawer-identity"><span className="personnel-drawer-avatar" aria-hidden="true">{initials}</span><div><p>Employee 360</p><h2 id="personnel-drawer-title">{fullName || 'พนักงาน'}</h2><div className="personnel-drawer-context"><span>รหัส {employee.employeeCode}</span><span>{employee.department || 'ไม่ระบุหน่วยงาน'}</span><span>{employee.jobTitle || 'ไม่ระบุตำแหน่ง'}</span><span className={`status-badge ${employee.isActive ? 'status-badge--success active' : 'status-badge--neutral inactive'}`}>{employee.isActive ? 'ปฏิบัติงาน' : 'ลาออก/ไม่ใช้งาน'}</span></div></div></div>
        <button ref={closeRef} type="button" className="personnel-drawer-close overlay-close" aria-label="ปิดรายละเอียดพนักงาน" onClick={onClose}><SmsIcon name="close" size={20} /></button>
      </header>
      <div className="personnel-drawer-content">
        <nav className="personnel-360-jump-nav" aria-label="เมนูย่อย Employee 360"><a href="#employee-360-overview">ภาพรวม</a><a href="#employee-360-structure">โครงสร้าง</a><a href="#employee-360-readiness">ความพร้อมลงเวลา</a><a href="#employee-360-history">ประวัติการเปลี่ยนแปลง</a></nav>
        <section className="personnel-360-state-strip" aria-label="สถานะสำคัญ">
          <div className={employee.isActive ? 'personnel-state-card personnel-state-card--ok' : 'personnel-state-card personnel-state-card--neutral'}><span>การจ้างงาน</span><strong>{employee.isActive ? 'ปฏิบัติงาน' : 'ไม่ปฏิบัติงาน'}</strong></div>
          <div className={activeRequest ? 'personnel-state-card personnel-state-card--warning' : 'personnel-state-card'}><span>คำขอเปลี่ยนแปลง</span><strong>{activeRequest ? requestStatusLabel[activeRequest.status] || activeRequest.status : statusLoading ? 'กำลังตรวจสอบ…' : 'ไม่มีรายการค้าง'}</strong>{activeRequest?.draftEffectiveMode === 'FUTURE_EFFECTIVE' && <small>มีผล {fmtDate(activeRequest.draftEffectiveDate)}</small>}</div>
          <div className={pendingLifecycle ? 'personnel-state-card personnel-state-card--warning' : 'personnel-state-card'}><span>Future-effective</span><strong>{pendingLifecycle ? lifecycleLabel[pendingLifecycle.type] || pendingLifecycle.type : statusLoading ? 'กำลังตรวจสอบ…' : 'ไม่มีรายการรอมีผล'}</strong>{pendingLifecycle && <small>{fmtDate(pendingLifecycle.effectiveDate)}</small>}</div>
          <div className={reference?.activePhoto ? 'personnel-state-card personnel-state-card--ok' : 'personnel-state-card personnel-state-card--warning'}><span>รูปอ้างอิงใบหน้า</span><strong>{reference?.activePhoto ? 'พร้อมใช้งาน' : statusLoading ? 'กำลังตรวจสอบ…' : 'ยังไม่พร้อม'}</strong>{reference?.pendingPhoto ? <small>มีรูปใหม่รอพิจารณา</small> : reference?.activePhoto ? <small>Reference Photo ACTIVE</small> : <small>ต้องมีรูป ACTIVE ก่อนตรวจสอบใบหน้า</small>}</div>
          <div className={accountReady(account) ? 'personnel-state-card personnel-state-card--ok' : account ? 'personnel-state-card personnel-state-card--warning' : 'personnel-state-card'}><span>บัญชีเข้าใช้งาน</span><strong>{account ? (accountReady(account) ? 'พร้อมใช้งาน' : 'ยังไม่พร้อมใช้งาน') : statusLoading ? 'กำลังตรวจสอบ…' : 'ยังไม่พบบัญชีเชื่อมโยง'}</strong>{account?.role && <small>สิทธิ์ {account.role}</small>}</div>
          <div className={expiringLicense ? 'personnel-state-card personnel-state-card--warning' : activeLicenses.length ? 'personnel-state-card personnel-state-card--ok' : 'personnel-state-card'}><span>ใบอนุญาต</span><strong>{expiringLicense ? 'ใกล้หมดอายุภายใน 30 วัน' : statusLoading ? 'กำลังตรวจสอบ…' : activeLicenses.length ? 'ไม่มีรายการใกล้หมดอายุ' : 'ไม่มีใบอนุญาตที่ Active'}</strong>{expiringLicense ? <small>{expiringLicense.licenseType || 'License'} · หมดอายุ {fmtDate(expiringLicense.expiryDate)}</small> : <small>Active {activeLicenses.length} รายการ</small>}</div>
        </section>
        {statusUnavailable && <div className="personnel-360-data-note" role="status">ข้อมูล governance บางส่วนไม่พร้อมใช้งาน จึงไม่คาดเดาสถานะจาก client</div>}
        <section id="employee-360-overview" className="personnel-detail-section" aria-labelledby="personnel-overview-title"><div className="personnel-section-heading"><span className="personnel-section-icon" aria-hidden="true"><SmsIcon name="employees" size={18} /></span><div><h3 id="personnel-overview-title">ภาพรวมและข้อมูลทั่วไป</h3><p>Employee identity เดียวสำหรับข้อมูลย้อนหลังทุกโมดูล</p></div></div><dl className="personnel-detail-grid"><div><dt>รหัสภายใน</dt><dd>{employee.employeeCode}</dd></div><div><dt>ชื่อ-นามสกุล</dt><dd>{fullName || 'ไม่ระบุ'}</dd></div><div><dt>อีเมลติดต่อ</dt><dd>{employee.email || 'ไม่ระบุ'}</dd></div><div><dt>โทรศัพท์</dt><dd>{employee.phone || 'ไม่ระบุ'}</dd></div><div><dt>วันที่เริ่มงาน</dt><dd>{fmtDate(employee.hiredAt)}</dd></div><div><dt>ทักษะ/คุณสมบัติ</dt><dd>{employee.skill || 'ไม่ระบุ'}</dd></div></dl></section>
        <section id="employee-360-structure" className="personnel-detail-section" aria-labelledby="personnel-structure-title"><div className="personnel-section-heading"><span className="personnel-section-icon" aria-hidden="true"><SmsIcon name="shield" size={18} /></span><div><h3 id="personnel-structure-title">การจ้างงานและโครงสร้าง</h3><p>Department / Position ใช้ Master authority สำหรับค่าที่เปลี่ยนใหม่</p></div></div><dl className="personnel-detail-grid"><div><dt>Department ปัจจุบัน</dt><dd>{employee.department || 'ไม่ระบุ'}</dd></div><div><dt>Position ปัจจุบัน</dt><dd>{employee.jobTitle || 'ไม่ระบุ'}</dd></div><div className="personnel-detail-grid__wide"><dt>Site context</dt><dd>อ้างอิงจาก Schedule / Security Site authority เมื่อปฏิบัติงาน ไม่กำหนดจาก Employee โดยเดา</dd></div></dl></section>
        <section id="employee-360-readiness" className="personnel-detail-section" aria-labelledby="personnel-domain-title"><div className="personnel-section-heading"><span className="personnel-section-icon" aria-hidden="true"><SmsIcon name="quality" size={18} /></span><div><h3 id="personnel-domain-title">ความพร้อมสำหรับการลงเวลา</h3><p>สรุปจาก authority ที่มีอยู่เท่านั้น และไม่ถือว่า READY หากยังขาดข้อมูลบังคับ</p></div></div><div className={`personnel-readiness-summary personnel-readiness-summary--${readiness.tone}`} role="status"><span>สถานะปัจจุบัน</span><strong>{readiness.label}</strong><p>{readiness.detail}</p></div><dl className="personnel-detail-grid"><div><dt>บัญชีผู้ใช้</dt><dd>{onboardingReadiness?.checks.account?.ready ? 'พร้อมใช้งาน' : 'ยังไม่พร้อม'}</dd></div><div><dt>Reference Photo</dt><dd>{onboardingReadiness?.checks.referencePhoto?.ready ? 'ACTIVE' : 'ยังไม่พร้อม'}</dd></div><div><dt>Schedule / Shift</dt><dd>{onboardingReadiness?.checks.schedule?.ready ? 'อนุมัติและพร้อมใช้งาน' : 'ยังไม่พร้อม'}</dd></div><div><dt>Security Site</dt><dd>{onboardingReadiness?.checks.site?.ready ? String(onboardingReadiness.checks.site.name || onboardingReadiness.checks.site.code || 'พร้อมใช้งาน') : 'ยังไม่พร้อม'}</dd></div><div><dt>Attendance Device</dt><dd>{onboardingReadiness?.checks.device?.ready ? 'Active cryptographic device พร้อมใช้งาน' : 'ยังไม่พร้อม'}</dd></div><div><dt>ใบอนุญาต Active</dt><dd>{activeLicenses.length} รายการ</dd></div>{onboardingReadiness?.blockers?.length ? <div className="personnel-detail-grid__wide"><dt>Blocking reasons</dt><dd>{onboardingReadiness.blockers.map((item) => `${item.label}: ${item.detail}`).join(' · ')}</dd></div> : null}</dl></section>
        <section id="employee-360-history" className="personnel-detail-section" aria-labelledby="personnel-change-title"><div className="personnel-section-heading"><span className="personnel-section-icon" aria-hidden="true"><SmsIcon name="history" size={18} /></span><div><h3 id="personnel-change-title">Change History Timeline</h3><p>ประวัติ lifecycle แบบอ่านอย่างเดียว · แสดงล่าสุดไม่เกิน 6 รายการ</p></div></div>{statusLoading && !history.length ? <div className="personnel-360-loading">กำลังโหลดประวัติ…</div> : history.length ? <ol className="personnel-360-timeline">{history.slice(0, 6).map((event) => <li key={event.id}><div><strong>{lifecycleLabel[event.type] || event.type}</strong><span className={`lifecycle-status lifecycle-status--${event.status.toLowerCase()}`}>{event.status === 'PENDING' ? 'รอวันที่มีผล' : 'มีผลแล้ว'}</span></div><time>{fmtDate(event.effectiveDate)}</time><p>{eventChange(event)}</p><small>{event.changedBy?.displayName || 'ผู้ดูแลระบบ'} · {fmtDateTime(event.createdAt)} · เหตุผล: {event.reason || '—'}</small></li>)}</ol> : <div className="personnel-360-empty">ยังไม่มี lifecycle history ที่ยืนยันได้</div>}</section>
      </div>
      {canManage && <footer className="personnel-drawer-actions"><button type="button" className="btn-primary personnel-drawer-primary" onClick={onEdit}><SmsIcon name="edit" size={17} />แก้ไขข้อมูล</button></footer>}
    </aside>
  </div>;
}
