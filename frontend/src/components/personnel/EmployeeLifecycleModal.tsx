import { useEffect, useMemo, useRef, useState } from 'react';
import { acquireDocumentScrollLock } from '../../document-scroll-lock';
import { SmsIcon } from '../SmsIcon';
import { api } from '../../api';
import { RequestErrorContent, toRequestErrorState, type RequestErrorInput } from '../../request-error';
import type { PersonnelRecord } from './types';
import '../../styles/employee-lifecycle.css';

type LifecycleType = 'NAME_CHANGE' | 'DEPARTMENT_TRANSFER' | 'POSITION_CHANGE' | 'EMPLOYMENT_TERMINATION' | 'REHIRE';
type CriticalMasterType = 'EMPLOYEE_CODE_CHANGE' | 'CONTACT_CHANGE' | 'HIRE_DATE_CORRECTION' | 'SKILL_QUALIFICATION_CHANGE';
type CriticalChangeType = LifecycleType | CriticalMasterType;
type StoredLifecycleType = LifecycleType | 'MASTER_EDIT';
type LifecycleIssue = { code: string; message: string; count?: number };
type Preflight = {
  expectedEmployeeUpdatedAt: string;
  latestLifecycleSequence: number;
  effectiveDate: string;
  currentState: Record<string, unknown>;
  proposedState: Record<string, unknown>;
  blockingIssues: LifecycleIssue[];
  warnings: LifecycleIssue[];
  impacts: Record<string, unknown>;
  changedFields?: string[];
  changes?: Record<string, unknown>;
  effectiveMode?: 'IMMEDIATE' | 'FUTURE_EFFECTIVE';
};
type LifecycleEvent = {
  id: string;
  type: StoredLifecycleType;
  status: 'PENDING' | 'APPLIED';
  effectiveDate: string;
  oldValue: { employee?: Record<string, unknown> };
  newValue: { employee?: Record<string, unknown> };
  reason: string;
  changedBy?: { displayName?: string; role?: string };
  createdAt: string;
};
type Props = { token: string; employee: PersonnelRecord; onClose(): void; onApplied(): void };

const typeLabels: Record<CriticalChangeType, string> = {
  NAME_CHANGE: 'เปลี่ยนชื่อ',
  DEPARTMENT_TRANSFER: 'ย้ายหน่วยงาน',
  POSITION_CHANGE: 'เปลี่ยนตำแหน่ง',
  EMPLOYMENT_TERMINATION: 'ลาออก',
  REHIRE: 'กลับเข้าทำงาน',
  EMPLOYEE_CODE_CHANGE: 'เปลี่ยนรหัสพนักงาน',
  CONTACT_CHANGE: 'เปลี่ยนข้อมูลติดต่อ',
  HIRE_DATE_CORRECTION: 'แก้ไขวันที่เริ่มงาน',
  SKILL_QUALIFICATION_CHANGE: 'ปรับทักษะ / คุณสมบัติ'
};
const masterTypes: CriticalMasterType[] = ['EMPLOYEE_CODE_CHANGE', 'CONTACT_CHANGE', 'HIRE_DATE_CORRECTION', 'SKILL_QUALIFICATION_CHANGE'];
const fieldLabels: Record<string, string> = {
  employeeCode: 'รหัสพนักงาน',
  firstName: 'ชื่อ',
  lastName: 'นามสกุล',
  email: 'อีเมล',
  phone: 'โทรศัพท์',
  department: 'หน่วยงาน',
  jobTitle: 'ตำแหน่ง',
  hiredAt: 'วันที่เริ่มงาน',
  skill: 'ทักษะ / คุณสมบัติ',
  isActive: 'สถานะการทำงาน'
};

const todayInput = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const cleanDate = (value?: string | null) => value ? String(value).slice(0, 10) : '';
const thaiDate = (value: string) => new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
const text = (value: unknown) => value === null || value === undefined || value === '' ? 'ไม่ระบุ' : String(value);
const impactCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const valueForHistory = (field: string, value: unknown) => {
  if (field === 'isActive') return value === true ? 'ปฏิบัติงาน' : 'ไม่ปฏิบัติงาน';
  if (field === 'hiredAt' && value) return thaiDate(String(value));
  return text(value);
};
const isMasterType = (value: CriticalChangeType): value is CriticalMasterType => masterTypes.includes(value as CriticalMasterType);

function masterChangedFields(event: LifecycleEvent) {
  const before = event.oldValue?.employee || {};
  const after = event.newValue?.employee || {};
  return Object.keys(fieldLabels).filter((field) => String(before[field] ?? '') !== String(after[field] ?? ''));
}

function historyTypeLabel(event: LifecycleEvent) {
  if (event.type !== 'MASTER_EDIT') return typeLabels[event.type];
  const fields = masterChangedFields(event);
  const before = event.oldValue?.employee || {};
  const after = event.newValue?.employee || {};
  if (fields.includes('isActive') && before.isActive === true && after.isActive === false) return typeLabels.EMPLOYMENT_TERMINATION;
  if (fields.includes('isActive') && before.isActive === false && after.isActive === true) return typeLabels.REHIRE;
  if (fields.length === 1 && fields[0] === 'employeeCode') return typeLabels.EMPLOYEE_CODE_CHANGE;
  if (fields.length && fields.every((field) => ['email', 'phone'].includes(field))) return typeLabels.CONTACT_CHANGE;
  if (fields.length === 1 && fields[0] === 'hiredAt') return typeLabels.HIRE_DATE_CORRECTION;
  if (fields.length === 1 && fields[0] === 'skill') return typeLabels.SKILL_QUALIFICATION_CHANGE;
  if (fields.length && fields.every((field) => ['firstName', 'lastName'].includes(field))) return typeLabels.NAME_CHANGE;
  if (fields.length === 1 && fields[0] === 'department') return typeLabels.DEPARTMENT_TRANSFER;
  if (fields.length === 1 && fields[0] === 'jobTitle') return typeLabels.POSITION_CHANGE;
  return 'แก้ไข Employee Master';
}

function eventChange(event: LifecycleEvent) {
  const before = event.oldValue?.employee || {};
  const after = event.newValue?.employee || {};
  if (event.type === 'NAME_CHANGE') return `${text(before.displayName)} → ${text(after.displayName)}`;
  if (event.type === 'DEPARTMENT_TRANSFER') return `${text(before.department)} → ${text(after.department)}`;
  if (event.type === 'POSITION_CHANGE') return `${text(before.jobTitle)} → ${text(after.jobTitle)}`;
  if (event.type === 'EMPLOYMENT_TERMINATION' || event.type === 'REHIRE') return `${text(before.employmentStatus)} → ${text(after.employmentStatus)}`;
  const fields = masterChangedFields(event);
  if (!fields.length) return 'บันทึกการแก้ไข Employee Master';
  const summaries = fields.slice(0, 3).map((field) => `${fieldLabels[field]}: ${valueForHistory(field, before[field])} → ${valueForHistory(field, after[field])}`);
  return `${summaries.join(' · ')}${fields.length > 3 ? ` · และอีก ${fields.length - 3} รายการ` : ''}`;
}

export function EmployeeLifecycleModal({ token, employee, onClose, onApplied }: Props) {
  const initialType: CriticalChangeType = employee.isActive ? 'NAME_CHANGE' : 'REHIRE';
  const [type, setType] = useState<CriticalChangeType>(initialType);
  const [effectiveDate, setEffectiveDate] = useState(todayInput());
  const [reason, setReason] = useState('');
  const [changes, setChanges] = useState({
    employeeCode: employee.employeeCode,
    firstName: employee.firstName,
    lastName: employee.lastName,
    department: employee.department || '',
    jobTitle: employee.jobTitle || '',
    email: employee.email || '',
    phone: employee.phone || '',
    hiredAt: cleanDate(employee.hiredAt),
    skill: employee.skill || ''
  });
  const [preflight, setPreflight] = useState<Preflight>();
  const [history, setHistory] = useState<LifecycleEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestErrorInput>();
  const [success, setSuccess] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  busyRef.current = busy;
  onCloseRef.current = onClose;

  const lifecycleTypes = useMemo<LifecycleType[]>(() => employee.isActive
    ? ['NAME_CHANGE', 'DEPARTMENT_TRANSFER', 'POSITION_CHANGE', 'EMPLOYMENT_TERMINATION']
    : ['REHIRE'], [employee.isActive]);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const result = await api.employeeLifecycleHistory(token, employee.id);
      setHistory(Array.isArray(result?.data) ? result.data : []);
    } catch (reasonValue) {
      setError(toRequestErrorState(reasonValue, 'ไม่สามารถโหลดประวัติการเปลี่ยนแปลงพนักงานได้'));
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => { void loadHistory(); }, [employee.id, token]);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseScrollLock = acquireDocumentScrollLock();
    const timer = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
      releaseScrollLock();
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, []);

  const invalidate = () => {
    setPreflight(undefined);
    setAcknowledgeWarnings(false);
    setError(undefined);
    setSuccess('');
    setIdempotencyKey(crypto.randomUUID());
  };

  const payloadChanges = (): Record<string, unknown> => {
    if (type === 'NAME_CHANGE') return { firstName: changes.firstName, lastName: changes.lastName };
    if (type === 'DEPARTMENT_TRANSFER') return { department: changes.department };
    if (type === 'POSITION_CHANGE') return { jobTitle: changes.jobTitle };
    if (type === 'REHIRE') return { department: changes.department, jobTitle: changes.jobTitle };
    if (type === 'EMPLOYEE_CODE_CHANGE') return { employeeCode: changes.employeeCode };
    if (type === 'CONTACT_CHANGE') return { email: changes.email.trim() || null, phone: changes.phone.trim() || null };
    if (type === 'HIRE_DATE_CORRECTION') return { hiredAt: changes.hiredAt || null };
    if (type === 'SKILL_QUALIFICATION_CHANGE') return { skill: changes.skill.trim() || null };
    return {};
  };

  const runPreflight = async () => {
    setBusy(true); setError(undefined); setSuccess(''); setAcknowledgeWarnings(false);
    try {
      if (isMasterType(type)) {
        const result = await api.preflightEmployeeMasterEdit(token, employee.id, {
          changes: payloadChanges(),
          effectiveMode: 'IMMEDIATE',
          effectiveDate: null,
          reason
        });
        setPreflight({ ...result.data, blockingIssues: result.data?.blockingIssues || [] });
      } else {
        const result = await api.preflightEmployeeLifecycle(token, employee.id, { type, effectiveDate, changes: payloadChanges() });
        setPreflight(result.data);
      }
    } catch (reasonValue) {
      setError(toRequestErrorState(reasonValue, 'ไม่สามารถตรวจสอบผลกระทบได้'));
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (!preflight || preflight.blockingIssues.length) return;
    if (preflight.warnings.length && !acknowledgeWarnings) {
      setError({ message: 'กรุณายืนยันว่าได้ตรวจสอบคำเตือนและผลกระทบแล้ว' });
      return;
    }
    if (type === 'EMPLOYMENT_TERMINATION' && confirmation !== employee.employeeCode) {
      setError({ message: 'กรุณาพิมพ์รหัสภายในให้ถูกต้องเพื่อยืนยันการลาออก' });
      return;
    }
    setBusy(true); setError(undefined);
    try {
      if (isMasterType(type)) {
        await api.updateEmployee(token, employee.id, {
          changes: preflight.changes || payloadChanges(),
          effectiveMode: 'IMMEDIATE',
          effectiveDate: null,
          reason,
          expectedEmployeeUpdatedAt: preflight.expectedEmployeeUpdatedAt,
          expectedLifecycleSequence: preflight.latestLifecycleSequence,
          idempotencyKey,
          acknowledgeWarnings
        });
        setSuccess('บันทึกการเปลี่ยนแปลงข้อมูลสำคัญเรียบร้อยแล้ว');
      } else {
        await api.createEmployeeLifecycleEvent(token, employee.id, {
          type,
          effectiveDate,
          changes: payloadChanges(),
          reason,
          expectedEmployeeUpdatedAt: preflight.expectedEmployeeUpdatedAt,
          expectedLifecycleSequence: preflight.latestLifecycleSequence,
          idempotencyKey,
          acknowledgeWarnings
        });
        setSuccess(effectiveDate > todayInput() ? 'บันทึกรายการล่วงหน้าแล้ว ระบบจะปรับข้อมูลเมื่อถึงวันที่มีผล' : 'บันทึกการเปลี่ยนแปลงเรียบร้อยแล้ว');
      }
      setPreflight(undefined);
      setAcknowledgeWarnings(false);
      setReason('');
      setConfirmation('');
      setIdempotencyKey(crypto.randomUUID());
      await loadHistory();
      onApplied();
    } catch (reasonValue) {
      setError(toRequestErrorState(reasonValue, 'บันทึกการเปลี่ยนแปลงไม่สำเร็จ'));
    } finally { setBusy(false); }
  };

  const warningsNeedAcknowledgement = Boolean(preflight?.warnings.length);
  const terminationNeedsConfirmation = type === 'EMPLOYMENT_TERMINATION' && Boolean(preflight);

  return <div className="lifecycle-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={modalRef} className="lifecycle-modal" role="dialog" aria-modal="true" aria-labelledby="lifecycle-title">
      <header className="lifecycle-header"><div><p>EMPLOYEE MASTER · CRITICAL CHANGES</p><h2 id="lifecycle-title">การเปลี่ยนแปลงสำคัญของพนักงาน</h2><span>{employee.employeeCode} · {employee.firstName} {employee.lastName}</span></div><button ref={closeRef} type="button" aria-label="ปิด" disabled={busy} onClick={onClose}><SmsIcon name="close" size={20} /></button></header>
      <div className="lifecycle-layout">
        <form className="lifecycle-form" onSubmit={(event) => { event.preventDefault(); void (preflight ? submit() : runPreflight()); }}>
          <div className="lifecycle-current"><strong>ข้อมูลปัจจุบัน</strong><span>{employee.department || 'ไม่ระบุหน่วยงาน'} · {employee.jobTitle || 'ไม่ระบุตำแหน่ง'} · {employee.isActive ? 'ปฏิบัติงาน' : 'ไม่ปฏิบัติงาน'}</span></div>
          <div className="lifecycle-guidance"><strong>ใช้สำหรับข้อมูลที่มีผลต่อประวัติบุคลากร</strong><span>รูปอ้างอิงใบหน้า ใบอนุญาต และสิทธิ์ระบบยังคงจัดการผ่าน workflow เฉพาะของแต่ละโมดูล</span></div>
          {error && <div className="lifecycle-alert lifecycle-alert--error" role="alert"><RequestErrorContent error={error} /></div>}
          {success && <div className="lifecycle-alert lifecycle-alert--success" role="status">{success}</div>}
          <label><span>รายการเปลี่ยนแปลง</span><select value={type} disabled={busy} onChange={(event) => { setType(event.target.value as CriticalChangeType); invalidate(); }}>
            <optgroup label="สถานะและโครงสร้างการปฏิบัติงาน">{lifecycleTypes.map((value) => <option key={value} value={value}>{typeLabels[value]}</option>)}</optgroup>
            <optgroup label="ข้อมูลสำคัญของ Employee Master">{masterTypes.map((value) => <option key={value} value={value}>{typeLabels[value]}</option>)}</optgroup>
          </select></label>

          {type === 'NAME_CHANGE' && <div className="lifecycle-field-grid"><label><span>ชื่อใหม่</span><input required value={changes.firstName} onChange={(event) => { setChanges({ ...changes, firstName: event.target.value }); invalidate(); }} /></label><label><span>นามสกุลใหม่</span><input required value={changes.lastName} onChange={(event) => { setChanges({ ...changes, lastName: event.target.value }); invalidate(); }} /></label></div>}
          {(type === 'DEPARTMENT_TRANSFER' || type === 'REHIRE') && <label><span>หน่วยงานใหม่</span><input required value={changes.department} onChange={(event) => { setChanges({ ...changes, department: event.target.value }); invalidate(); }} /></label>}
          {(type === 'POSITION_CHANGE' || type === 'REHIRE') && <label><span>ตำแหน่งใหม่</span><input required value={changes.jobTitle} onChange={(event) => { setChanges({ ...changes, jobTitle: event.target.value }); invalidate(); }} /></label>}
          {type === 'EMPLOYEE_CODE_CHANGE' && <label><span>รหัสพนักงานใหม่</span><input required maxLength={50} value={changes.employeeCode} onChange={(event) => { setChanges({ ...changes, employeeCode: event.target.value }); invalidate(); }} /><small>รหัสต้องไม่ซ้ำกับพนักงานรายอื่น</small></label>}
          {type === 'CONTACT_CHANGE' && <div className="lifecycle-field-grid"><label><span>อีเมลติดต่อ</span><input type="email" maxLength={255} value={changes.email} onChange={(event) => { setChanges({ ...changes, email: event.target.value }); invalidate(); }} /></label><label><span>โทรศัพท์</span><input maxLength={50} value={changes.phone} onChange={(event) => { setChanges({ ...changes, phone: event.target.value }); invalidate(); }} /></label></div>}
          {type === 'HIRE_DATE_CORRECTION' && <label><span>วันที่เริ่มงานที่ถูกต้อง</span><input type="date" value={changes.hiredAt} onChange={(event) => { setChanges({ ...changes, hiredAt: event.target.value }); invalidate(); }} /></label>}
          {type === 'SKILL_QUALIFICATION_CHANGE' && <label><span>ทักษะ / คุณสมบัติ</span><textarea maxLength={255} value={changes.skill} onChange={(event) => { setChanges({ ...changes, skill: event.target.value }); invalidate(); }} /></label>}

          {isMasterType(type)
            ? <><div className="lifecycle-effective-note"><strong>มีผลทันที</strong><span>ข้อมูลประเภทนี้เป็น immediate-only ตาม Employee Master policy และไม่สามารถตั้งวันที่มีผลล่วงหน้าได้</span></div><label><span>เหตุผล</span><textarea required minLength={3} maxLength={1000} value={reason} onChange={(event) => { setReason(event.target.value); invalidate(); }} /></label></>
            : <div className="lifecycle-field-grid"><label><span>วันที่มีผล</span><input type="date" required value={effectiveDate} onChange={(event) => { setEffectiveDate(event.target.value); invalidate(); }} /></label><label><span>เหตุผล</span><textarea required minLength={3} maxLength={1000} value={reason} onChange={(event) => { setReason(event.target.value); invalidate(); }} /></label></div>}

          {preflight && <section className="lifecycle-preflight" aria-label="ผลการตรวจสอบผลกระทบ"><h3>ผลกระทบและคำเตือน</h3>{preflight.blockingIssues.map((issue) => <div className="lifecycle-issue lifecycle-issue--blocking" key={issue.code}><b>ไม่สามารถดำเนินการ</b><span>{issue.message}</span></div>)}{preflight.warnings.map((issue) => <div className="lifecycle-issue" key={issue.code}><b>ควรตรวจสอบ</b><span>{issue.message}{issue.count !== undefined ? ` (${issue.count} รายการ)` : ''}</span></div>)}{!preflight.blockingIssues.length && !preflight.warnings.length && <p className="lifecycle-no-impact">ไม่พบประเด็นที่ต้องยืนยันเพิ่มเติม</p>}<div className="lifecycle-impact-groups"><div className="lifecycle-impact-group lifecycle-impact-group--clear"><b>ไม่กระทบ</b><span>{preflight.blockingIssues.length === 0 && preflight.warnings.length === 0 && ['futureShiftAssignments','pendingLeaveRequests','approvedFutureLeaveRequests','activeLicenses','licenseDocuments','activeAttendanceDevices','approvalAuthorityReferences'].every((key) => impactCount(preflight.impacts[key]) === 0) ? 'ไม่พบผลกระทบที่ต้องติดตาม' : '—'}</span></div><div className="lifecycle-impact-group lifecycle-impact-group--review"><b>ต้องตรวจสอบ</b><span>{preflight.blockingIssues.length + preflight.warnings.length} ประเด็น</span></div><div className="lifecycle-impact-group lifecycle-impact-group--follow"><b>ต้องติดตาม</b><span>{['futureShiftAssignments','pendingLeaveRequests','approvedFutureLeaveRequests','activeLicenses','licenseDocuments','activeAttendanceDevices','approvalAuthorityReferences'].reduce((sum, key) => sum + impactCount(preflight.impacts[key]), 0)} รายการอ้างอิง</span></div></div><dl className="lifecycle-impact-grid"><div><dt>เวรในอนาคต</dt><dd>{text(preflight.impacts.futureShiftAssignments)}</dd></div><div><dt>ลารอพิจารณา</dt><dd>{text(preflight.impacts.pendingLeaveRequests)}</dd></div><div><dt>ลาอนุมัติในอนาคต</dt><dd>{text(preflight.impacts.approvedFutureLeaveRequests)}</dd></div><div><dt>โควต้าวันลา</dt><dd>{text(preflight.impacts.leaveQuotaRecords)}</dd></div><div><dt>ใบอนุญาตใช้งาน</dt><dd>{text(preflight.impacts.activeLicenses)}</dd></div><div><dt>เอกสารใบอนุญาต</dt><dd>{text(preflight.impacts.licenseDocuments)}</dd></div><div><dt>Attendance Device Active</dt><dd>{text(preflight.impacts.activeAttendanceDevices)}</dd></div><div><dt>Approval Authority</dt><dd>{preflight.impacts.approvalAuthorityReferences === null ? 'ตรวจสอบไม่ได้' : text(preflight.impacts.approvalAuthorityReferences)}</dd></div><div><dt>บัญชีผู้ใช้เชื่อมโยง</dt><dd>{preflight.impacts.linkedUser && typeof preflight.impacts.linkedUser === 'object' && 'present' in preflight.impacts.linkedUser && preflight.impacts.linkedUser.present ? 'พบ' : 'ไม่พบ'}</dd></div></dl>{warningsNeedAcknowledgement && <label className="lifecycle-warning-confirm"><input type="checkbox" checked={acknowledgeWarnings} onChange={(event) => setAcknowledgeWarnings(event.target.checked)} /> ตรวจสอบคำเตือนและผลกระทบแล้ว และยืนยันให้ดำเนินการ</label>}</section>}
          {terminationNeedsConfirmation && <label className="lifecycle-confirm"><span>พิมพ์รหัสภายใน {employee.employeeCode} เพื่อยืนยันการลาออก</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>}
          <footer><button type="button" className="btn-neutral" disabled={busy} onClick={onClose}>ยกเลิก</button><button type="submit" className={type === 'EMPLOYMENT_TERMINATION' && preflight ? 'lifecycle-danger' : 'btn-primary'} disabled={busy || Boolean(preflight?.blockingIssues.length) || (warningsNeedAcknowledgement && !acknowledgeWarnings) || (terminationNeedsConfirmation && confirmation !== employee.employeeCode)}>{busy ? 'กำลังดำเนินการ…' : preflight ? `ยืนยัน${typeLabels[type]}` : 'ตรวจสอบผลกระทบ'}</button></footer>
        </form>
        <aside className="lifecycle-history"><header><h3>ประวัติการเปลี่ยนแปลงสำคัญ</h3><span>อ่านอย่างเดียว</span></header>{loadingHistory ? <p>กำลังโหลดประวัติ…</p> : history.length ? <ol>{history.map((event) => <li key={event.id}><div><b>{historyTypeLabel(event)}</b><span className={`lifecycle-status lifecycle-status--${event.status.toLowerCase()}`}>{event.status === 'APPLIED' ? 'มีผลแล้ว' : 'รอวันที่มีผล'}</span></div><time>{thaiDate(event.effectiveDate)}</time><strong>{eventChange(event)}</strong><p>เหตุผล: {event.reason}</p><small>โดย {event.changedBy?.displayName || 'ผู้ดูแลระบบ'} ({event.changedBy?.role || 'ADMIN'}) · บันทึก {new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.createdAt))}</small></li>)}</ol> : <div className="lifecycle-empty">ยังไม่มีประวัติการเปลี่ยนแปลงที่ยืนยันได้</div>}</aside>
      </div>
    </section>
  </div>;
}
