import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { acquireDocumentScrollLock } from '../../document-scroll-lock';
import { SmsIcon } from '../SmsIcon';
import type { PersonnelRecord } from './types';
import { roleDisplayName } from '../../role-display';
import { formatThaiDate, formatThaiDateTime } from '../../thai-date-time';
import { currentBangkokQuotaYear, thaiQuotaYearLabel } from '../../leave-quota-provisioning';
import { getEmployeeLeaveQuota } from '../../leave-request-quota-api';
import { getEmployeeLicenses, type EmployeeLicense } from '../../employee-license-api';

type Props = {
  employee?: PersonnelRecord;
  token?: string;
  canManage: boolean;
  role?: string;
  onClose(): void;
  onEdit(): void;
};

type ChangeRequest = { id: string; status: string; draftEffectiveMode?: string; draftEffectiveDate?: string | null; draftProposal?: Record<string, unknown> | null; draftReason?: string | null };
type LifecycleEvent = { id: string; type: string; status: 'PENDING' | 'APPLIED'; effectiveDate: string; reason: string; createdAt: string; oldValue?: { employee?: Record<string, unknown> }; newValue?: { employee?: Record<string, unknown> }; changedBy?: { displayName?: string; role?: string } };
type ReferenceState = { activePhoto?: { id: string; activatedAt?: string | null } | null; pendingPhoto?: { id: string; uploadedAt?: string | null } | null };
type AccountState = { id: string; employeeId?: string | null; accountStatus?: string; isActive?: boolean; role?: string };
type LicenseState = EmployeeLicense;
type OnboardingReadiness = { checks: Record<string, { ready: boolean; [key: string]: unknown }> };

const activeRequestStatuses = new Set(['DRAFT', 'PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION']);
const requestStatusLabel: Record<string, string> = { DRAFT: 'ฉบับร่าง', PENDING_APPROVAL: `รอ ${roleDisplayName('ADMIN')} อนุมัติ`, RETURNED_FOR_CORRECTION: 'ส่งกลับให้แก้ไข' };
const lifecycleLabel: Record<string, string> = { NAME_CHANGE: 'เปลี่ยนชื่อ', DEPARTMENT_TRANSFER: 'ย้ายหน่วยงาน', POSITION_CHANGE: 'เปลี่ยนตำแหน่ง', EMPLOYMENT_TERMINATION: 'ลาออก', REHIRE: 'กลับเข้าทำงาน', MASTER_EDIT: 'แก้ไขข้อมูลพนักงาน' };
const fieldLabel: Record<string, string> = { firstName: 'ชื่อ', lastName: 'นามสกุล', department: 'หน่วยงาน', jobTitle: 'ตำแหน่ง', isActive: 'สถานะ', email: 'อีเมล', phone: 'โทรศัพท์', hiredAt: 'วันที่เริ่มงาน', skill: 'ทักษะ/คุณสมบัติ' };
const fmtDate = (value?: string | null) => value ? formatThaiDate(value, { dateStyle: 'medium' }) : '—';
const fmtDateTime = (value?: string | null) => value ? formatThaiDateTime(value) : '—';
const valueText = (field: string, value: unknown) => field === 'isActive' ? (value === true ? 'ปฏิบัติงาน' : 'ลาออก') : value === null || value === undefined || value === '' ? '—' : String(value);
const accountReady = (account?: AccountState) => Boolean(account && account.accountStatus === 'ACTIVE' && account.isActive !== false);

function OnboardingItem({ label, status, detail, tone, href }: { label: string; status: string; detail: string; tone: 'success' | 'warning' | 'neutral'; href?: string }) {
  return <li className={`personnel-onboarding-item personnel-onboarding-item--${tone}`}><div><div className="personnel-onboarding-item__heading"><strong>{label}</strong><span>{status}</span></div><p>{detail}</p></div>{href && <a href={href}>ไปจัดการ</a>}</li>;
}


function eventChange(event: LifecycleEvent) {
  const before = event.oldValue?.employee || {};
  const after = event.newValue?.employee || {};
  const changed = Object.keys(fieldLabel).filter((field) => String(before[field] ?? '') !== String(after[field] ?? ''));
  if (!changed.length) return lifecycleLabel[event.type] || 'รายการเปลี่ยนแปลง';
  return changed.slice(0, 3).map((field) => `${fieldLabel[field] || field}: ${valueText(field, before[field])} → ${valueText(field, after[field])}`).join(' · ');
}

export function PersonnelDetailDrawer({ employee, token, canManage, role, onClose, onEdit }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [history, setHistory] = useState<LifecycleEvent[]>([]);
  const [reference, setReference] = useState<ReferenceState>();
  const [account, setAccount] = useState<AccountState>();
  const [accountUnavailable, setAccountUnavailable] = useState(false);
  const [licenses, setLicenses] = useState<LicenseState[]>();
  const [quotaRows, setQuotaRows] = useState<Array<Record<string, unknown>>>();
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
    if (!employee || !token) { setRequests([]); setHistory([]); setReference(undefined); setAccount(undefined); setAccountUnavailable(false); setLicenses(undefined); setQuotaRows(undefined); setOnboardingReadiness(undefined); setStatusUnavailable(false); return; }
    let active = true;
    setStatusLoading(true); setStatusUnavailable(false);
    const quotaYear = currentBangkokQuotaYear();
    Promise.allSettled([api.employeeChangeRequests(token, employee.id), api.employeeLifecycleHistory(token, employee.id, 1), api.employeeReferencePhotos(token, employee.id), api.users(token), getEmployeeLicenses(token, employee.id), getEmployeeLeaveQuota(token, quotaYear, employee.id), api.employeeOnboardingReadiness(token, employee.id)]).then((results) => {
      if (!active) return;
      const [requestResult, historyResult, photoResult, userResult, licenseResult, quotaResult, readinessResult] = results;
      if (requestResult.status === 'fulfilled') setRequests(Array.isArray(requestResult.value?.data) ? requestResult.value.data as ChangeRequest[] : []);
      if (historyResult.status === 'fulfilled') setHistory(Array.isArray(historyResult.value?.data) ? historyResult.value.data as LifecycleEvent[] : []);
      if (photoResult.status === 'fulfilled') setReference((photoResult.value?.data || {}) as ReferenceState);
      if (userResult.status === 'fulfilled') { const rows = Array.isArray(userResult.value?.data) ? userResult.value.data as AccountState[] : []; setAccount(rows.find((row) => String(row.employeeId || '') === employee.id)); setAccountUnavailable(false); }
      else { setAccount(undefined); setAccountUnavailable(true); }
      if (licenseResult.status === 'fulfilled') setLicenses(Array.isArray(licenseResult.value?.data) ? licenseResult.value.data : undefined);
      if (quotaResult.status === 'fulfilled') setQuotaRows(Array.isArray(quotaResult.value?.data) ? quotaResult.value.data : undefined);
      if (readinessResult.status === 'fulfilled') setOnboardingReadiness((readinessResult.value?.data || undefined) as OnboardingReadiness | undefined);
      setStatusUnavailable(results.every((result) => result.status === 'rejected'));
    }).finally(() => { if (active) setStatusLoading(false); });
    return () => { active = false; };
  }, [employee?.id, token]);

  const activeRequest = useMemo(() => requests.find((request) => activeRequestStatuses.has(request.status)), [requests]);
  const pendingLifecycle = useMemo(() => history.find((event) => event.status === 'PENDING'), [history]);
  const activeLicenses = useMemo(() => licenses?.filter((license) => license.status === 'Active') ?? [], [licenses]);
  const expiringLicense = useMemo(() => activeLicenses.filter((license) => { if (!license.expiryDate) return false; const days = (new Date(license.expiryDate).getTime() - Date.now()) / 86400000; return days >= 0 && days <= 30; }).sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)))[0], [activeLicenses]);
  if (!employee) return null;
  const fullName = `${employee.firstName} ${employee.lastName}`.trim();
  const initials = fullName.split(/\s+/).filter(Boolean).map((value) => value[0]).join('').slice(0, 2) || 'SM';
  const quotaYear = currentBangkokQuotaYear();
  const employeeQuery = `employeeId=${encodeURIComponent(employee.id)}`;
  const accountCheck = onboardingReadiness?.checks.account;
  const scheduleCheck = onboardingReadiness?.checks.schedule;
  const siteCheck = onboardingReadiness?.checks.site;
  const deviceCheck = onboardingReadiness?.checks.device;
  const readinessStatus = (check?: { ready: boolean }) => statusLoading ? { status: 'กำลังตรวจสอบ', detail: 'กำลังอ่านข้อมูลจากระบบ', tone: 'neutral' as const } : !check ? { status: 'ตรวจสอบไม่ได้', detail: 'ระบบไม่ส่งผลตรวจรายการนี้ จึงไม่สรุปสถานะ', tone: 'neutral' as const } : check.ready ? { status: 'พบข้อมูล', detail: 'ยืนยันจากผลตรวจของระบบ', tone: 'success' as const } : { status: 'ยังไม่พบ', detail: 'ระบบยังไม่ยืนยันข้อมูลนี้', tone: 'warning' as const };
  const accountItem = readinessStatus(accountCheck);
  const scheduleItem = readinessStatus(scheduleCheck);
  const siteItem = readinessStatus(siteCheck);
  const deviceItem = readinessStatus(deviceCheck);
  const licenseStatus = statusLoading ? { status: 'กำลังตรวจสอบ', detail: 'กำลังอ่านรายการใบอนุญาตจากระบบ', tone: 'neutral' as const } : !licenses ? { status: 'ตรวจสอบไม่ได้', detail: 'ระบบไม่ส่งรายการใบอนุญาต จึงไม่ถือว่าเป็นศูนย์รายการ', tone: 'neutral' as const } : { status: activeLicenses?.length ? `ยังใช้งาน ${activeLicenses.length} รายการ` : 'ไม่พบใบอนุญาตที่ยังใช้งาน', detail: 'นับจากสถานะใบอนุญาตที่ระบบส่งกลับ', tone: activeLicenses?.length ? 'success' as const : 'warning' as const };
  const quotaRecord = quotaRows?.[0];
  const quotaStatus = statusLoading ? { status: 'กำลังตรวจสอบ', detail: `กำลังอ่านข้อมูลปี ${thaiQuotaYearLabel(quotaYear)}`, tone: 'neutral' as const } : !quotaRows ? { status: 'ตรวจสอบไม่ได้', detail: 'ระบบไม่ส่งข้อมูลโควตา จึงไม่ถือว่าไม่มีสิทธิ์', tone: 'neutral' as const } : quotaRows.length ? { status: `พบข้อมูล ${quotaRows.length} รายการ`, detail: quotaRecord ? `คงเหลือจากระบบ · ป่วย ${String(quotaRecord.sickLeaveRemaining ?? '—')} · ธุระ ${String(quotaRecord.personalLeaveRemaining ?? '—')} · พักร้อน ${String(quotaRecord.vacationLeaveRemaining ?? '—')} วัน` : `โควตาปี ${thaiQuotaYearLabel(quotaYear)} จากระบบ`, tone: 'success' as const } : { status: 'ยังไม่พบข้อมูลปีนี้', detail: `ยังไม่มีรายการโควตาที่แสดงได้สำหรับปี ${thaiQuotaYearLabel(quotaYear)}`, tone: 'warning' as const };

  return <div className="personnel-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={drawerRef} className="personnel-detail-drawer personnel-detail-drawer--360 operational-drawer" role="dialog" aria-modal="true" aria-labelledby="personnel-drawer-title">
      <header className="personnel-drawer-header personnel-360-header">
        <div className="personnel-drawer-identity"><span className="personnel-drawer-avatar" aria-hidden="true">{initials}</span><div><p>ข้อมูลพนักงาน</p><h2 id="personnel-drawer-title">{fullName || 'พนักงาน'}</h2><div className="personnel-drawer-context"><span>รหัส {employee.employeeCode}</span><span>{employee.department || 'ไม่ระบุหน่วยงาน'}</span><span>{employee.jobTitle || 'ไม่ระบุตำแหน่ง'}</span><span className={`status-badge ${employee.isActive ? 'status-badge--success active' : 'status-badge--neutral inactive'}`}>{employee.isActive ? 'ปฏิบัติงาน' : 'ลาออก/ไม่ใช้งาน'}</span></div></div></div>
        <button ref={closeRef} type="button" className="personnel-drawer-close overlay-close" aria-label="ปิดรายละเอียดพนักงาน" onClick={onClose}><SmsIcon name="close" size={20} /></button>
      </header>
      <div className="personnel-drawer-content">
        <nav className="personnel-360-jump-nav" aria-label="เมนูย่อยข้อมูลพนักงาน"><a href="#employee-360-overview">ภาพรวม</a><a href="#employee-360-structure">โครงสร้าง</a><a href="#employee-360-readiness">รายการเตรียมความพร้อม</a><a href="#employee-360-history">ประวัติการเปลี่ยนแปลง</a></nav>
        <section className="personnel-360-state-strip" aria-label="สถานะสำคัญ">
          <div className={employee.isActive ? 'personnel-state-card personnel-state-card--ok' : 'personnel-state-card personnel-state-card--neutral'}><span>การจ้างงาน</span><strong>{employee.isActive ? 'ปฏิบัติงาน' : 'ไม่ปฏิบัติงาน'}</strong></div>
          <div className={activeRequest ? 'personnel-state-card personnel-state-card--warning' : 'personnel-state-card'}><span>คำขอเปลี่ยนแปลง</span><strong>{activeRequest ? requestStatusLabel[activeRequest.status] || 'ไม่ระบุสถานะ' : statusLoading ? 'กำลังตรวจสอบ…' : 'ไม่มีรายการค้าง'}</strong>{activeRequest?.draftEffectiveMode === 'FUTURE_EFFECTIVE' && <small>มีผล {fmtDate(activeRequest.draftEffectiveDate)}</small>}</div>
          <div className={pendingLifecycle ? 'personnel-state-card personnel-state-card--warning' : 'personnel-state-card'}><span>รายการรอมีผล</span><strong>{pendingLifecycle ? lifecycleLabel[pendingLifecycle.type] || 'รายการเปลี่ยนแปลง' : statusLoading ? 'กำลังตรวจสอบ…' : 'ไม่มีรายการรอมีผล'}</strong>{pendingLifecycle && <small>{fmtDate(pendingLifecycle.effectiveDate)}</small>}</div>
          <div className={reference?.activePhoto ? 'personnel-state-card personnel-state-card--ok' : 'personnel-state-card personnel-state-card--neutral'}><span>รูปอ้างอิงใบหน้า</span><strong>{statusLoading ? 'กำลังตรวจสอบ…' : !reference ? 'ตรวจสอบไม่ได้' : reference.activePhoto ? 'มีรูปที่ใช้งาน' : 'ยังไม่มีรูปที่ใช้งาน'}</strong>{reference?.pendingPhoto && <small>มีรูปใหม่รอพิจารณา</small>}</div>
          <div className={accountReady(account) ? 'personnel-state-card personnel-state-card--ok' : account || accountUnavailable ? 'personnel-state-card personnel-state-card--warning' : 'personnel-state-card'}><span>บัญชีเข้าใช้งาน</span><strong>{account ? (accountReady(account) ? 'พร้อมใช้งาน' : 'ยังไม่พร้อมใช้งาน') : statusLoading ? 'กำลังตรวจสอบ…' : accountUnavailable ? 'ตรวจสอบไม่ได้' : 'ยังไม่พบบัญชีเชื่อมโยง'}</strong>{account?.role && <small>สิทธิ์ {roleDisplayName(account.role)}</small>}</div>
          <div className={expiringLicense ? 'personnel-state-card personnel-state-card--warning' : activeLicenses.length ? 'personnel-state-card personnel-state-card--ok' : 'personnel-state-card'}><span>ใบอนุญาต</span><strong>{expiringLicense ? 'ใกล้หมดอายุภายใน 30 วัน' : statusLoading ? 'กำลังตรวจสอบ…' : !licenses ? 'ตรวจสอบไม่ได้' : activeLicenses.length ? 'ไม่มีรายการใกล้หมดอายุ' : 'ไม่มีใบอนุญาตที่ยังใช้งาน'}</strong>{expiringLicense ? <small>{expiringLicense.licenseType || 'ใบอนุญาต'} · หมดอายุ {fmtDate(expiringLicense.expiryDate)}</small> : <small>{licenses ? `ยังใช้งาน ${activeLicenses.length} รายการ` : 'ไม่ถือว่าข้อมูลที่โหลดไม่สำเร็จเป็นศูนย์รายการ'}</small>}</div>
        </section>
        {statusUnavailable && <div className="personnel-360-data-note" role="status">ข้อมูล governance บางส่วนไม่พร้อมใช้งาน จึงไม่คาดเดาสถานะจาก client</div>}
        <section id="employee-360-overview" className="personnel-detail-section" aria-labelledby="personnel-overview-title"><div className="personnel-section-heading"><span className="personnel-section-icon" aria-hidden="true"><SmsIcon name="employees" size={18} /></span><div><h3 id="personnel-overview-title">ภาพรวมและข้อมูลทั่วไป</h3><p>ใช้ข้อมูลประจำตัวพนักงานชุดเดียวกันเพื่อดูประวัติในทุกส่วน</p></div></div><dl className="personnel-detail-grid"><div><dt>รหัสภายใน</dt><dd>{employee.employeeCode}</dd></div><div><dt>ชื่อ-นามสกุล</dt><dd>{fullName || 'ไม่ระบุ'}</dd></div><div><dt>อีเมลติดต่อ</dt><dd>{employee.email || 'ไม่ระบุ'}</dd></div><div><dt>โทรศัพท์</dt><dd>{employee.phone || 'ไม่ระบุ'}</dd></div><div><dt>วันที่เริ่มงาน</dt><dd>{fmtDate(employee.hiredAt)}</dd></div><div><dt>ทักษะ/คุณสมบัติ</dt><dd>{employee.skill || 'ไม่ระบุ'}</dd></div></dl></section>
        <section id="employee-360-structure" className="personnel-detail-section" aria-labelledby="personnel-structure-title"><div className="personnel-section-heading"><span className="personnel-section-icon" aria-hidden="true"><SmsIcon name="shield" size={18} /></span><div><h3 id="personnel-structure-title">การจ้างงานและโครงสร้าง</h3><p>หน่วยงานและตำแหน่งใหม่ต้องเลือกจากรายการที่ระบบกำหนด</p></div></div><dl className="personnel-detail-grid"><div><dt>หน่วยงานปัจจุบัน</dt><dd>{employee.department || 'ไม่ระบุ'}</dd></div><div><dt>ตำแหน่งปัจจุบัน</dt><dd>{employee.jobTitle || 'ไม่ระบุ'}</dd></div><div className="personnel-detail-grid__wide"><dt>จุดปฏิบัติงาน</dt><dd>อ้างอิงจากตารางกะและจุดรักษาความปลอดภัยเมื่อปฏิบัติงาน ไม่คาดเดาจากข้อมูลพนักงาน</dd></div></dl></section>
        <section id="employee-360-readiness" className="personnel-detail-section" aria-labelledby="personnel-domain-title"><div className="personnel-section-heading"><span className="personnel-section-icon" aria-hidden="true"><SmsIcon name="quality" size={18} /></span><div><h3 id="personnel-domain-title">รายการเตรียมความพร้อม</h3><p>แสดงสถานะรายข้อจากระบบ ไม่คำนวณผลรวมและไม่กำหนดเงื่อนไขการลงเวลาในหน้านี้</p></div></div><ul className="personnel-onboarding-list" aria-label="รายการเตรียมความพร้อมของพนักงาน"><OnboardingItem label="บัญชีผู้ใช้เชื่อมโยง" status={accountItem.status} detail={accountItem.detail} tone={accountItem.tone} href={role === 'ADMIN' ? `/app/users?${employeeQuery}` : undefined} /><OnboardingItem label="ใบอนุญาตที่ยังใช้งาน" status={licenseStatus.status} detail={licenseStatus.detail} tone={licenseStatus.tone} href={canManage ? `/app/licenses?${employeeQuery}` : undefined} /><OnboardingItem label={`โควตาวันลา · ${thaiQuotaYearLabel(quotaYear)}`} status={quotaStatus.status} detail={quotaStatus.detail} tone={quotaStatus.tone} href={canManage ? `/app/leave/quotas?${employeeQuery}&year=${quotaYear}` : undefined} /><OnboardingItem label="ตารางกะที่อนุมัติ" status={scheduleItem.status} detail={scheduleItem.detail} tone={scheduleItem.tone} href={canManage ? `/app/roster?${employeeQuery}` : undefined} /><OnboardingItem label="จุดรักษาความปลอดภัย" status={siteItem.status} detail={siteCheck?.ready ? String(siteCheck.name || siteCheck.code || 'ระบบยืนยันจุดปฏิบัติงาน') : siteItem.detail} tone={siteItem.tone} href={role === 'ADMIN' ? `/app/sites?${employeeQuery}` : undefined} /><OnboardingItem label="อุปกรณ์ลงเวลาตามสัญญาระบบ" status={deviceItem.status} detail={deviceCheck?.ready ? 'ระบบยืนยันอุปกรณ์ที่ยังใช้งานและผ่านการตรวจสอบ' : deviceItem.detail} tone={deviceItem.tone} href={canManage ? `/app/devices?${employeeQuery}` : undefined} /></ul><p className="personnel-onboarding-note">รายการเหล่านี้เป็นข้อมูลประกอบการจัดเตรียมพนักงาน แต่ละระบบยังคงตรวจสอบสิทธิ์และเงื่อนไขของตนเอง</p></section>
        <section id="employee-360-history" className="personnel-detail-section" aria-labelledby="personnel-change-title"><div className="personnel-section-heading"><span className="personnel-section-icon" aria-hidden="true"><SmsIcon name="history" size={18} /></span><div><h3 id="personnel-change-title">ประวัติการเปลี่ยนแปลง</h3><p>ประวัติช่วงการเปลี่ยนแปลงแบบอ่านอย่างเดียว · แสดงล่าสุดไม่เกิน 6 รายการ</p></div></div>{statusLoading && !history.length ? <div className="personnel-360-loading">กำลังโหลดประวัติ…</div> : history.length ? <ol className="personnel-360-timeline">{history.slice(0, 6).map((event) => <li key={event.id}><div><strong>{lifecycleLabel[event.type] || 'รายการเปลี่ยนแปลง'}</strong><span className={`lifecycle-status lifecycle-status--${event.status.toLowerCase()}`}>{event.status === 'PENDING' ? 'รอวันที่มีผล' : 'มีผลแล้ว'}</span></div><time>{fmtDate(event.effectiveDate)}</time><p>{eventChange(event)}</p><small>{event.changedBy?.displayName || 'ผู้ดูแลระบบ'} · {fmtDateTime(event.createdAt)} · เหตุผล: {event.reason || '—'}</small></li>)}</ol> : <div className="personnel-360-empty">ยังไม่มี ประวัติการเปลี่ยนแปลงที่ยืนยันได้</div>}</section>
      </div>
      {canManage && <footer className="personnel-drawer-actions"><button type="button" className="btn-primary personnel-drawer-primary" onClick={onEdit}><SmsIcon name="edit" size={17} />แก้ไขข้อมูล</button></footer>}
    </aside>
  </div>;
}
