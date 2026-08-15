import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { RequestErrorContent, toRequestErrorState, type RequestErrorInput } from '../../request-error';
import type { PersonnelRecord } from './types';
import '../../styles/employee-lifecycle.css';

type LifecycleType = 'NAME_CHANGE' | 'DEPARTMENT_TRANSFER' | 'POSITION_CHANGE' | 'EMPLOYMENT_TERMINATION' | 'REHIRE';
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
};
type LifecycleEvent = {
  id: string;
  type: LifecycleType;
  status: 'PENDING' | 'APPLIED';
  effectiveDate: string;
  oldValue: { employee?: Record<string, unknown> };
  newValue: { employee?: Record<string, unknown> };
  reason: string;
  changedBy?: { displayName?: string; role?: string };
  createdAt: string;
};
type Props = { token: string; employee: PersonnelRecord; onClose(): void; onApplied(): void };

const typeLabels: Record<LifecycleType, string> = {
  NAME_CHANGE: 'เปลี่ยนชื่อ',
  DEPARTMENT_TRANSFER: 'ย้ายแผนก',
  POSITION_CHANGE: 'เปลี่ยนตำแหน่ง',
  EMPLOYMENT_TERMINATION: 'ลาออก',
  REHIRE: 'กลับเข้าทำงาน'
};

const todayInput = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const thaiDate = (value: string) => new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
const text = (value: unknown) => value === null || value === undefined || value === '' ? 'ไม่ระบุ' : String(value);
function eventChange(event: LifecycleEvent) {
  const before = event.oldValue?.employee || {};
  const after = event.newValue?.employee || {};
  if (event.type === 'NAME_CHANGE') return `${text(before.displayName)} → ${text(after.displayName)}`;
  if (event.type === 'DEPARTMENT_TRANSFER') return `${text(before.department)} → ${text(after.department)}`;
  if (event.type === 'POSITION_CHANGE') return `${text(before.jobTitle)} → ${text(after.jobTitle)}`;
  return `${text(before.employmentStatus)} → ${text(after.employmentStatus)}`;
}

export function EmployeeLifecycleModal({ token, employee, onClose, onApplied }: Props) {
  const initialType: LifecycleType = employee.isActive ? 'NAME_CHANGE' : 'REHIRE';
  const [type, setType] = useState<LifecycleType>(initialType);
  const [effectiveDate, setEffectiveDate] = useState(todayInput());
  const [reason, setReason] = useState('');
  const [changes, setChanges] = useState({ firstName: employee.firstName, lastName: employee.lastName, department: employee.department || '', jobTitle: employee.jobTitle || '' });
  const [preflight, setPreflight] = useState<Preflight>();
  const [history, setHistory] = useState<LifecycleEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestErrorInput>();
  const [success, setSuccess] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const availableTypes = useMemo<LifecycleType[]>(() => employee.isActive
    ? ['NAME_CHANGE', 'DEPARTMENT_TRANSFER', 'POSITION_CHANGE', 'EMPLOYMENT_TERMINATION']
    : ['REHIRE'], [employee.isActive]);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const result = await api.employeeLifecycleHistory(token, employee.id);
      setHistory(Array.isArray(result?.data) ? result.data : []);
    } catch (reasonValue) {
      setError(toRequestErrorState(reasonValue, 'ไม่สามารถโหลดประวัติวงจรพนักงานได้'));
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => { void loadHistory(); }, [employee.id, token]);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  const invalidate = () => { setPreflight(undefined); setError(undefined); setSuccess(''); setIdempotencyKey(crypto.randomUUID()); };
  const payloadChanges = () => {
    if (type === 'NAME_CHANGE') return { firstName: changes.firstName, lastName: changes.lastName };
    if (type === 'DEPARTMENT_TRANSFER') return { department: changes.department };
    if (type === 'POSITION_CHANGE') return { jobTitle: changes.jobTitle };
    if (type === 'REHIRE') return { department: changes.department, jobTitle: changes.jobTitle };
    return {};
  };

  const runPreflight = async () => {
    setBusy(true); setError(undefined); setSuccess('');
    try {
      const result = await api.preflightEmployeeLifecycle(token, employee.id, { type, effectiveDate, changes: payloadChanges() });
      setPreflight(result.data);
    } catch (reasonValue) {
      setError(toRequestErrorState(reasonValue, 'ไม่สามารถตรวจสอบผลกระทบได้'));
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (!preflight || preflight.blockingIssues.length) return;
    if (type === 'EMPLOYMENT_TERMINATION' && confirmation !== employee.employeeCode) {
      setError({ message: 'กรุณาพิมพ์รหัสพนักงานให้ถูกต้องเพื่อยืนยันการลาออก' });
      return;
    }
    setBusy(true); setError(undefined);
    try {
      await api.createEmployeeLifecycleEvent(token, employee.id, {
        type,
        effectiveDate,
        changes: payloadChanges(),
        reason,
        expectedEmployeeUpdatedAt: preflight.expectedEmployeeUpdatedAt,
        expectedLifecycleSequence: preflight.latestLifecycleSequence,
        idempotencyKey,
        acknowledgeWarnings: true
      });
      setSuccess(effectiveDate > todayInput() ? 'บันทึกรายการล่วงหน้าแล้ว ระบบจะปรับข้อมูลเมื่อถึงวันที่มีผล' : 'บันทึกการเปลี่ยนแปลงเรียบร้อยแล้ว');
      setPreflight(undefined); setReason(''); setConfirmation(''); setIdempotencyKey(crypto.randomUUID());
      await loadHistory();
      onApplied();
    } catch (reasonValue) {
      setError(toRequestErrorState(reasonValue, 'บันทึกการเปลี่ยนแปลงไม่สำเร็จ'));
    } finally { setBusy(false); }
  };

  return <div className="lifecycle-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="lifecycle-modal" role="dialog" aria-modal="true" aria-labelledby="lifecycle-title">
      <header className="lifecycle-header"><div><p>EMPLOYEE LIFECYCLE</p><h2 id="lifecycle-title">จัดการวงจรพนักงาน</h2><span>{employee.employeeCode} · {employee.firstName} {employee.lastName}</span></div><button type="button" aria-label="ปิด" disabled={busy} onClick={onClose}>×</button></header>
      <div className="lifecycle-layout">
        <form className="lifecycle-form" onSubmit={(event) => { event.preventDefault(); void (preflight ? submit() : runPreflight()); }}>
          <div className="lifecycle-current"><strong>ข้อมูลปัจจุบัน</strong><span>{employee.department || 'ไม่ระบุหน่วยงาน'} · {employee.jobTitle || 'ไม่ระบุตำแหน่ง'} · {employee.isActive ? 'ปฏิบัติงาน' : 'ไม่ปฏิบัติงาน'}</span></div>
          {error && <div className="lifecycle-alert lifecycle-alert--error" role="alert"><RequestErrorContent error={error} /></div>}
          {success && <div className="lifecycle-alert lifecycle-alert--success" role="status">{success}</div>}
          <label><span>รายการ</span><select value={type} disabled={busy} onChange={(event) => { setType(event.target.value as LifecycleType); invalidate(); }}>{availableTypes.map((value) => <option key={value} value={value}>{typeLabels[value]}</option>)}</select></label>
          {type === 'NAME_CHANGE' && <div className="lifecycle-field-grid"><label><span>ชื่อใหม่</span><input required value={changes.firstName} onChange={(event) => { setChanges({ ...changes, firstName: event.target.value }); invalidate(); }} /></label><label><span>นามสกุลใหม่</span><input required value={changes.lastName} onChange={(event) => { setChanges({ ...changes, lastName: event.target.value }); invalidate(); }} /></label></div>}
          {(type === 'DEPARTMENT_TRANSFER' || type === 'REHIRE') && <label><span>หน่วยงานใหม่</span><input required value={changes.department} onChange={(event) => { setChanges({ ...changes, department: event.target.value }); invalidate(); }} /></label>}
          {(type === 'POSITION_CHANGE' || type === 'REHIRE') && <label><span>ตำแหน่งใหม่</span><input required value={changes.jobTitle} onChange={(event) => { setChanges({ ...changes, jobTitle: event.target.value }); invalidate(); }} /></label>}
          <div className="lifecycle-field-grid"><label><span>วันที่มีผล</span><input type="date" required value={effectiveDate} onChange={(event) => { setEffectiveDate(event.target.value); invalidate(); }} /></label><label><span>เหตุผล</span><textarea required minLength={3} maxLength={1000} value={reason} onChange={(event) => { setReason(event.target.value); invalidate(); }} /></label></div>
          {preflight && <section className="lifecycle-preflight" aria-label="ผลการตรวจสอบผลกระทบ"><h3>ผลกระทบและคำเตือน</h3>{preflight.blockingIssues.map((issue) => <div className="lifecycle-issue lifecycle-issue--blocking" key={issue.code}><b>ไม่สามารถดำเนินการ</b><span>{issue.message}</span></div>)}{preflight.warnings.map((issue) => <div className="lifecycle-issue" key={issue.code}><b>ควรตรวจสอบ</b><span>{issue.message}{issue.count !== undefined ? ` (${issue.count} รายการ)` : ''}</span></div>)}{!preflight.blockingIssues.length && !preflight.warnings.length && <p className="lifecycle-no-impact">ไม่พบประเด็นที่ต้องยืนยันเพิ่มเติม</p>}<dl className="lifecycle-impact-grid"><div><dt>เวรในอนาคต</dt><dd>{text(preflight.impacts.futureShiftAssignments)}</dd></div><div><dt>ลารอพิจารณา</dt><dd>{text(preflight.impacts.pendingLeaveRequests)}</dd></div><div><dt>ลาอนุมัติในอนาคต</dt><dd>{text(preflight.impacts.approvedFutureLeaveRequests)}</dd></div><div><dt>โควต้าวันลา</dt><dd>{text(preflight.impacts.leaveQuotaRecords)}</dd></div><div><dt>ใบอนุญาตใช้งาน</dt><dd>{text(preflight.impacts.activeLicenses)}</dd></div><div><dt>เอกสารใบอนุญาต</dt><dd>{text(preflight.impacts.licenseDocuments)}</dd></div><div><dt>บัญชีผู้ใช้เชื่อมโยง</dt><dd>{preflight.impacts.linkedUser && typeof preflight.impacts.linkedUser === 'object' && 'present' in preflight.impacts.linkedUser && preflight.impacts.linkedUser.present ? 'พบ' : 'ไม่พบ'}</dd></div></dl></section>}
          {type === 'EMPLOYMENT_TERMINATION' && preflight && <label className="lifecycle-confirm"><span>พิมพ์รหัส {employee.employeeCode} เพื่อยืนยันการลาออก</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>}
          <footer><button type="button" className="btn-neutral" disabled={busy} onClick={onClose}>ยกเลิก</button><button type="submit" className={type === 'EMPLOYMENT_TERMINATION' && preflight ? 'lifecycle-danger' : 'btn-primary'} disabled={busy || (Boolean(preflight?.blockingIssues.length))}>{busy ? 'กำลังดำเนินการ…' : preflight ? `ยืนยัน${typeLabels[type]}` : 'ตรวจสอบผลกระทบ'}</button></footer>
        </form>
        <aside className="lifecycle-history"><header><h3>ประวัติวงจรพนักงาน</h3><span>อ่านอย่างเดียว</span></header>{loadingHistory ? <p>กำลังโหลดประวัติ…</p> : history.length ? <ol>{history.map((event) => <li key={event.id}><div><b>{typeLabels[event.type]}</b><span className={`lifecycle-status lifecycle-status--${event.status.toLowerCase()}`}>{event.status === 'APPLIED' ? 'มีผลแล้ว' : 'รอวันที่มีผล'}</span></div><time>{thaiDate(event.effectiveDate)}</time><strong>{eventChange(event)}</strong><p>เหตุผล: {event.reason}</p><small>โดย {event.changedBy?.displayName || 'ผู้ดูแลระบบ'} ({event.changedBy?.role || 'ADMIN'}) · บันทึก {new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.createdAt))}</small></li>)}</ol> : <div className="lifecycle-empty">ยังไม่มีประวัติการเปลี่ยนแปลงที่ยืนยันได้</div>}</aside>
      </div>
    </section>
  </div>;
}
