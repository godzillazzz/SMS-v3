import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiRequestError } from '../../api';
import { acquireDocumentScrollLock } from '../../document-scroll-lock';
import { RequestErrorContent, toRequestErrorState, type RequestErrorInput } from '../../request-error';
import { approvalActionPresentation } from '../../approval-workflow-semantics';
import { SmsIcon } from '../SmsIcon';
import { EmployeeReferencePhotoPanel } from './EmployeeReferencePhotoPanel';
import type { PersonnelRecord, PersonnelRole } from './types';
import '../../styles/employee-governed-edit.css';

type ChangeRequest = {
  id: string;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'RETURNED_FOR_CORRECTION' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  currentRevision: number;
  approvedRevision?: number | null;
  draftProposal?: Record<string, unknown> | null;
  draftEffectiveMode?: 'IMMEDIATE' | 'FUTURE_EFFECTIVE';
  draftEffectiveDate?: string | null;
  draftReason?: string | null;
  lastReviewerComment?: string | null;
  approvedAt?: string | null;
  appliedAt?: string | null;
  cancelledAt?: string | null;
  rejectedAt?: string | null;
  revisions?: Array<{ revision: number; beforeSnapshot: Record<string, unknown>; afterSnapshot: Record<string, unknown>; changedFields: string[]; effectiveMode: string; effectiveDate?: string | null; reason?: string | null; submittedAt: string; submittedBy?: { displayName?: string } }>;
  events?: Array<{ id: string; action: string; createdAt: string; reason?: string | null; actor?: { displayName?: string } }>;
};

type Preflight = {
  changedFields: string[];
  changes: Record<string, unknown>;
  effectiveMode: 'IMMEDIATE' | 'FUTURE_EFFECTIVE';
  effectiveDate: string;
  expectedEmployeeUpdatedAt: string;
  latestLifecycleSequence: number;
  warnings: Array<{ code: string; message: string; count?: number }>;
  impacts: { futureShiftAssignments?: number; pendingLeaveRequests?: number; approvedFutureLeaveRequests?: number; activeLicenses?: number; licenseDocuments?: number };
};

type Props = { token: string; employee: PersonnelRecord; role: PersonnelRole; onClose(): void; onChanged(): void };
type CriticalChangeAction = 'NAME_CHANGE' | 'DEPARTMENT_TRANSFER' | 'POSITION_CHANGE' | 'EMPLOYMENT_TERMINATION' | 'REHIRE';
type PersonnelMasterOption = { id: string; name: string; isActive: boolean; sortOrder?: number };
type PersonnelMasterData = { departments: PersonnelMasterOption[]; positions: PersonnelMasterOption[] };

const criticalActionLabels: Record<CriticalChangeAction, string> = {
  NAME_CHANGE: 'เปลี่ยนชื่อ',
  DEPARTMENT_TRANSFER: 'ย้ายหน่วยงาน',
  POSITION_CHANGE: 'เปลี่ยนตำแหน่ง',
  EMPLOYMENT_TERMINATION: 'ลาออก',
  REHIRE: 'กลับเข้าทำงาน'
};
const criticalFields = new Set(['firstName', 'lastName', 'department', 'jobTitle', 'isActive']);
const inferCriticalAction = (proposal: Record<string, unknown> | null | undefined): CriticalChangeAction | null => {
  if (!proposal) return null;
  if (Object.prototype.hasOwnProperty.call(proposal, 'isActive')) return proposal.isActive === false ? 'EMPLOYMENT_TERMINATION' : 'REHIRE';
  if (Object.prototype.hasOwnProperty.call(proposal, 'department')) return 'DEPARTMENT_TRANSFER';
  if (Object.prototype.hasOwnProperty.call(proposal, 'jobTitle')) return 'POSITION_CHANGE';
  if (Object.prototype.hasOwnProperty.call(proposal, 'firstName') || Object.prototype.hasOwnProperty.call(proposal, 'lastName')) return 'NAME_CHANGE';
  return null;
};
const revisionCriticalLabels = (fields: string[]) => {
  const values: string[] = [];
  if (fields.some((field) => field === 'firstName' || field === 'lastName')) values.push('เปลี่ยนชื่อ');
  if (fields.includes('department')) values.push('ย้ายหน่วยงาน');
  if (fields.includes('jobTitle')) values.push('เปลี่ยนตำแหน่ง');
  if (fields.includes('isActive')) values.push('เปลี่ยนสถานะการจ้าง');
  return values;
};
const activeStatuses = new Set(['DRAFT', 'PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION']);
const operationalFields = ['employeeCode', 'firstName', 'lastName', 'department', 'jobTitle', 'isActive'] as const;
const adminFields = [...operationalFields, 'email', 'phone', 'hiredAt', 'skill'] as const;
const labels: Record<string, string> = { employeeCode: 'รหัสพนักงาน', firstName: 'ชื่อ', lastName: 'นามสกุล', email: 'อีเมลติดต่อ', phone: 'โทรศัพท์', department: 'หน่วยงาน', jobTitle: 'ตำแหน่ง', hiredAt: 'วันที่เริ่มงาน', skill: 'ทักษะ/คุณสมบัติ', isActive: 'สถานะการทำงาน' };
const statusLabel: Record<string, string> = { DRAFT: 'ฉบับร่าง', PENDING_APPROVAL: 'รอ Admin อนุมัติ', RETURNED_FOR_CORRECTION: 'ส่งกลับให้แก้ไข', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิกแล้ว' };
const cancelAction = approvalActionPresentation('CANCEL');
const resubmitAction = approvalActionPresentation('RESUBMIT');
const cleanDate = (value?: string | null) => value ? String(value).slice(0, 10) : '';
const display = (field: string, value: unknown) => field === 'isActive' ? (value === true ? 'ปฏิบัติงาน' : 'ลาออก') : value === null || value === undefined || value === '' ? '—' : String(value).slice(0, 10 + (field === 'hiredAt' ? 0 : 500));
const errorCode = (error: unknown) => error instanceof ApiRequestError && error.details && typeof error.details === 'object' && 'code' in error.details ? String((error.details as { code?: unknown }).code || '') : '';

export function EmployeeGovernedEditModal({ token, employee, role, onClose, onChanged }: Props) {
  const modalRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const isAdmin = role === 'ADMIN';
  const fields = isAdmin ? adminFields : operationalFields;
  const [form, setForm] = useState<Record<string, unknown>>(() => ({ employeeCode: employee.employeeCode, firstName: employee.firstName, lastName: employee.lastName, department: employee.department || '', jobTitle: employee.jobTitle || '', isActive: employee.isActive, email: employee.email || '', phone: employee.phone || '', hiredAt: cleanDate(employee.hiredAt), skill: employee.skill || '' }));
  const [effectiveMode, setEffectiveMode] = useState<'IMMEDIATE' | 'FUTURE_EFFECTIVE'>('IMMEDIATE');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestErrorInput>();
  const [notice, setNotice] = useState('');
  const [preflight, setPreflight] = useState<Preflight>();
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const [criticalAction, setCriticalAction] = useState<CriticalChangeAction | null>(null);
  const [personnelMasters, setPersonnelMasters] = useState<PersonnelMasterData>({ departments: [], positions: [] });
  const [personnelMastersLoading, setPersonnelMastersLoading] = useState(true);
  const [personnelMastersError, setPersonnelMastersError] = useState('');

  const activeRequest = useMemo(() => requests.find((request) => activeStatuses.has(request.status)), [requests]);
  const latestRequest = requests[0];
  const pendingReadOnly = !isAdmin && activeRequest?.status === 'PENDING_APPROVAL';

  useEffect(() => {
    const release = acquireDocumentScrollLock();
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 0);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', key);
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', key); release(); previous?.focus({ preventScroll: true }); };
  }, [busy, onClose]);

  const loadRequests = async () => {
    setLoading(true);
    try {
      const result = await api.employeeChangeRequests(token, employee.id);
      const rows = Array.isArray(result?.data) ? result.data as ChangeRequest[] : [];
      setRequests(rows);
      const active = rows.find((request) => activeStatuses.has(request.status));
      if (!isAdmin && active && ['DRAFT', 'PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION'].includes(active.status)) {
        setForm((current) => ({ ...current, ...(active.draftProposal || {}) }));
        setEffectiveMode(active.draftEffectiveMode || 'IMMEDIATE');
        setEffectiveDate(cleanDate(active.draftEffectiveDate));
        setReason(active.draftReason || '');
        setCriticalAction(inferCriticalAction(active.draftProposal));
      }
    } catch (cause) { setError(toRequestErrorState(cause, 'ไม่สามารถโหลดประวัติคำขอแก้ไขพนักงานได้')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadRequests(); }, [employee.id, token]);
  useEffect(() => {
    let active = true;
    setPersonnelMastersLoading(true); setPersonnelMastersError('');
    api.personnelMasters(token, true).then((result) => {
      if (!active) return;
      const data = result?.data as PersonnelMasterData | undefined;
      setPersonnelMasters({ departments: Array.isArray(data?.departments) ? data!.departments : [], positions: Array.isArray(data?.positions) ? data!.positions : [] });
    }).catch(() => { if (active) setPersonnelMastersError('ไม่สามารถโหลด Department / Position Master ได้ จึงปิดการเปลี่ยนหน่วยงานและตำแหน่งไว้ชั่วคราว'); })
      .finally(() => { if (active) setPersonnelMastersLoading(false); });
    return () => { active = false; };
  }, [token]);

  const changes = useMemo(() => {
    const next: Record<string, unknown> = {};
    for (const field of fields) {
      const original = field === 'department' || field === 'jobTitle' || field === 'email' || field === 'phone' || field === 'skill' ? (employee[field] || '') : field === 'hiredAt' ? cleanDate(employee.hiredAt) : employee[field];
      const current = form[field];
      if (String(current ?? '') !== String(original ?? '')) next[field] = field === 'isActive' ? Boolean(current) : current === '' ? null : current;
    }
    return next;
  }, [employee, fields, form]);
  const hasCriticalChanges = Object.keys(changes).some((field) => criticalFields.has(field));
  const criticalReasonRequired = hasCriticalChanges;
  const criticalReasonMissing = criticalReasonRequired && reason.trim().length < 3;

  const invalidate = () => { setPreflight(undefined); setAcknowledgeWarnings(false); setNotice(''); setError(undefined); };
  const update = (field: string, value: unknown) => { setForm((current) => ({ ...current, [field]: value })); invalidate(); };
  const criticalBase = () => ({
    firstName: employee.firstName,
    lastName: employee.lastName,
    department: employee.department || '',
    jobTitle: employee.jobTitle || '',
    isActive: employee.isActive
  });
  const selectCriticalAction = (action: CriticalChangeAction) => {
    if (criticalAction === action) return;
    setForm((current) => ({
      ...current,
      ...criticalBase(),
      ...(action === 'EMPLOYMENT_TERMINATION' ? { isActive: false } : {}),
      ...(action === 'REHIRE' ? { isActive: true } : {})
    }));
    setCriticalAction(action);
    invalidate();
  };
  const resetCriticalAction = () => {
    setForm((current) => ({ ...current, ...criticalBase() }));
    setCriticalAction(null);
    invalidate();
  };

  const runPreflight = async () => {
    if (!isAdmin || !Object.keys(changes).length) { if (!Object.keys(changes).length) setError('ยังไม่มีข้อมูลที่เปลี่ยนแปลง'); return; }
    if (criticalReasonMissing) { setError('การเปลี่ยนแปลงสำคัญต้องระบุเหตุผลอย่างน้อย 3 ตัวอักษร'); return; }
    setBusy(true); setError(undefined); setNotice('');
    try {
      const result = await api.preflightEmployeeMasterEdit(token, employee.id, { changes, effectiveMode, effectiveDate: effectiveMode === 'FUTURE_EFFECTIVE' ? effectiveDate : null, reason: reason || null });
      setPreflight(result?.data as Preflight);
    } catch (cause) {
      const code = errorCode(cause);
      setError(code === 'EMPLOYEE_CHANGE_MIXED_EFFECTIVE_TIMING' ? 'คำขอนี้มีข้อมูลที่ต้องมีผลทันทีและข้อมูลที่กำหนดวันที่มีผลในอนาคต กรุณาแยกเป็นคนละรายการแก้ไข' : toRequestErrorState(cause, 'ไม่สามารถตรวจสอบผลกระทบได้'));
    } finally { setBusy(false); }
  };

  const saveAdmin = async () => {
    if (!preflight) { await runPreflight(); return; }
    setBusy(true); setError(undefined);
    try {
      await api.updateEmployee(token, employee.id, { changes: preflight.changes, effectiveMode: preflight.effectiveMode, effectiveDate: preflight.effectiveMode === 'FUTURE_EFFECTIVE' ? preflight.effectiveDate : null, reason: reason || null, expectedEmployeeUpdatedAt: preflight.expectedEmployeeUpdatedAt, expectedLifecycleSequence: preflight.latestLifecycleSequence, idempotencyKey: crypto.randomUUID(), acknowledgeWarnings });
      onChanged(); onClose();
    } catch (cause) {
      const code = errorCode(cause);
      setError(code === 'EMPLOYEE_CHANGE_MIXED_EFFECTIVE_TIMING' ? 'คำขอนี้มีข้อมูลที่ต้องมีผลทันทีและข้อมูลที่กำหนดวันที่มีผลในอนาคต กรุณาแยกเป็นคนละรายการแก้ไข' : toRequestErrorState(cause, 'บันทึกการแก้ไข Employee Master ไม่สำเร็จ'));
    } finally { setBusy(false); }
  };

  const submitManager = async () => {
    if (!Object.keys(changes).length) { setError('ยังไม่มีข้อมูลที่เปลี่ยนแปลง'); return; }
    if (criticalReasonMissing) { setError('การเปลี่ยนแปลงสำคัญต้องระบุเหตุผลอย่างน้อย 3 ตัวอักษร'); return; }
    setBusy(true); setError(undefined);
    try {
      const draftPayload = { proposal: changes, effectiveMode, effectiveDate: effectiveMode === 'FUTURE_EFFECTIVE' ? effectiveDate : null, reason: reason || null, idempotencyKey: crypto.randomUUID() };
      if (!activeRequest) {
        const created = await api.createEmployeeChangeDraft(token, employee.id, draftPayload);
        const request = created?.data as ChangeRequest;
        await api.submitEmployeeChangeRequest(token, request.id, crypto.randomUUID());
      } else if (activeRequest.status === 'DRAFT') {
        await api.saveEmployeeChangeDraft(token, activeRequest.id, draftPayload);
        await api.submitEmployeeChangeRequest(token, activeRequest.id, crypto.randomUUID());
      } else if (activeRequest.status === 'RETURNED_FOR_CORRECTION') {
        await api.saveEmployeeChangeDraft(token, activeRequest.id, draftPayload);
        await api.resubmitEmployeeChangeRequest(token, activeRequest.id, crypto.randomUUID());
      } else throw new Error('คำขอนี้อยู่ระหว่างรออนุมัติ');
      setNotice(activeRequest?.status === 'RETURNED_FOR_CORRECTION' ? 'ส่ง Revision ใหม่ให้ Admin ตรวจสอบแล้ว' : 'ส่งคำขอแก้ไขให้ Admin ตรวจสอบแล้ว');
      await loadRequests(); onChanged();
    } catch (cause) {
      const code = errorCode(cause);
      setError(code === 'EMPLOYEE_CHANGE_MIXED_EFFECTIVE_TIMING' ? 'คำขอนี้มีข้อมูลที่ต้องมีผลทันทีและข้อมูลที่กำหนดวันที่มีผลในอนาคต กรุณาแยกเป็นคนละรายการแก้ไข' : toRequestErrorState(cause, 'ส่งคำขอแก้ไขพนักงานไม่สำเร็จ'));
    } finally { setBusy(false); }
  };

  const cancelRequest = async () => {
    if (!activeRequest || !window.confirm('ยืนยันยกเลิกคำขอแก้ไขนี้?')) return;
    setBusy(true); setError(undefined);
    try { await api.cancelEmployeeChangeRequest(token, activeRequest.id, crypto.randomUUID()); await loadRequests(); onChanged(); }
    catch (cause) { setError(toRequestErrorState(cause, 'ยกเลิกคำขอไม่สำเร็จ')); }
    finally { setBusy(false); }
  };

  const history = requests.flatMap((request) => (request.revisions || []).map((revision) => ({ request, revision }))).sort((a, b) => b.revision.revision - a.revision.revision);
  const modal = <div className="employee-governed-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={modalRef} className="employee-governed-modal" role="dialog" aria-modal="true" aria-labelledby="employee-governed-title">
      <header className="employee-governed-header"><div><p>EMPLOYEE MASTER · GOVERNED EDIT</p><h2 id="employee-governed-title">แก้ไขข้อมูลพนักงาน</h2><span>{employee.employeeCode} · {employee.firstName} {employee.lastName}</span></div><button ref={closeRef} type="button" aria-label="ปิด" onClick={onClose} disabled={busy}><SmsIcon name="close" size={20} /></button></header>
      <div className="employee-governed-body">
        {!isAdmin && activeRequest && <div className={`employee-request-banner employee-request-banner--${activeRequest.status.toLowerCase()}`}><strong>{statusLabel[activeRequest.status]}</strong><span>Request · Revision {activeRequest.currentRevision || '—'}</span>{activeRequest.lastReviewerComment && <p>ความเห็น Admin: {activeRequest.lastReviewerComment}</p>}</div>}
        {!isAdmin && activeRequest && <section className="employee-authoritative-context"><strong>ข้อมูล Employee Master ปัจจุบัน</strong><div><span>รหัส {employee.employeeCode}</span><span>{employee.firstName} {employee.lastName}</span><span>{employee.department || 'ไม่ระบุหน่วยงาน'}</span><span>{employee.jobTitle || 'ไม่ระบุตำแหน่ง'}</span><span>{employee.isActive ? 'ปฏิบัติงาน' : 'ลาออก'}</span></div><small>{activeRequest.status === 'PENDING_APPROVAL' ? 'ข้อเสนอที่ส่งแล้วแสดงแบบอ่านอย่างเดียวด้านล่าง' : activeRequest.status === 'RETURNED_FOR_CORRECTION' ? 'ฟอร์มด้านล่างเป็นข้อเสนอเดิมที่ส่งกลับมาให้แก้ไข โดย Revision ก่อนหน้ายังคงไม่เปลี่ยนแปลง' : 'ฟอร์มด้านล่างเป็นฉบับร่างที่ยังไม่ส่งตรวจสอบ'}</small></section>}
        {latestRequest?.status === 'APPROVED' && !latestRequest.appliedAt && latestRequest.revisions?.some((revision) => revision.effectiveMode === 'FUTURE_EFFECTIVE') && <div className="employee-request-banner employee-request-banner--approved"><strong>อนุมัติแล้ว · รอวันที่มีผล</strong></div>}
        {error && <div className="employee-governed-alert employee-governed-alert--error"><RequestErrorContent error={error} /></div>}
        {notice && <div className="employee-governed-alert employee-governed-alert--success">{notice}</div>}
        <section className="employee-governed-section"><h3>1. ข้อมูลทั่วไป</h3><div className="employee-governed-grid">
          <label><span>รหัสพนักงาน</span><input value={String(employee.employeeCode || '')} readOnly aria-readonly="true" /><small>รหัสพนักงานเป็นข้อมูลอ้างอิงหลัก ไม่แก้ไขตรงจากหน้าข้อมูลทั่วไป</small></label>
          <label><span>ชื่อปัจจุบัน</span><input value={String(employee.firstName || '')} readOnly aria-readonly="true" /><small>หากต้องการแก้ไข ให้ใช้ “เปลี่ยนชื่อ” ในหัวข้อ 3. การเปลี่ยนแปลง</small></label>
          <label><span>นามสกุลปัจจุบัน</span><input value={String(employee.lastName || '')} readOnly aria-readonly="true" /><small>เก็บชื่อเดิมเป็นประวัติ และใช้ Employee ID เดิม</small></label>
          {isAdmin && <><label><span>อีเมลติดต่อ</span><input type="email" value={String(form.email || '')} onChange={(event) => update('email', event.target.value)} /></label><label><span>โทรศัพท์</span><input value={String(form.phone || '')} onChange={(event) => update('phone', event.target.value)} /></label></>}
        </div></section>
        <section className="employee-governed-section"><h3>2. ข้อมูลการปฏิบัติงาน</h3><div className="employee-governed-grid">
          <label><span>หน่วยงานปัจจุบัน</span><input value={String(employee.department || '')} readOnly aria-readonly="true" /><small>ใช้ “ย้ายหน่วยงาน” ในหัวข้อ 3 เพื่อเปลี่ยนอย่างมีประวัติ</small></label>
          <label><span>ตำแหน่งปัจจุบัน</span><input value={String(employee.jobTitle || '')} readOnly aria-readonly="true" /><small>ใช้ “เปลี่ยนตำแหน่ง” ในหัวข้อ 3 เพื่อเปลี่ยนอย่างมีประวัติ</small></label>
          {isAdmin && <><label><span>วันที่เริ่มงาน</span><input type="date" value={cleanDate(employee.hiredAt)} readOnly aria-readonly="true" /><small>วันที่เริ่มงานเป็นข้อมูลลำดับเหตุการณ์การจ้าง หากต้องแก้ต้องใช้ workflow แก้ไขประวัติที่มีเหตุผลและ Audit</small></label><label className="employee-governed-wide"><span>ทักษะ / คุณสมบัติ</span><input value={String(form.skill || '')} onChange={(event) => update('skill', event.target.value)} /></label></>}
        </div></section>
        <section className="employee-governed-section employee-critical-change-section">
          <h3>3. การเปลี่ยนแปลง</h3>
          <small className="employee-governed-section-note">เลือกประเภทการเปลี่ยนแปลงสำคัญจากจุดเดียว ระบบจะคง Employee ID เดิม เก็บ Before → After, วันที่มีผล, ผู้ดำเนินการ, เหตุผล และ Audit ตาม Workflow เดิม</small>
          <div className="employee-change-action-grid" role="group" aria-label="ประเภทการเปลี่ยนแปลงพนักงาน">
            <button type="button" className={criticalAction === 'NAME_CHANGE' ? 'is-active' : ''} disabled={pendingReadOnly || busy} onClick={() => selectCriticalAction('NAME_CHANGE')}><strong>เปลี่ยนชื่อ</strong><small>{employee.firstName} {employee.lastName}</small></button>
            <button type="button" className={criticalAction === 'DEPARTMENT_TRANSFER' ? 'is-active' : ''} disabled={pendingReadOnly || busy} onClick={() => selectCriticalAction('DEPARTMENT_TRANSFER')}><strong>ย้ายหน่วยงาน / แผนก</strong><small>{employee.department || 'ยังไม่ระบุหน่วยงาน'}</small></button>
            <button type="button" className={criticalAction === 'POSITION_CHANGE' ? 'is-active' : ''} disabled={pendingReadOnly || busy} onClick={() => selectCriticalAction('POSITION_CHANGE')}><strong>เปลี่ยนตำแหน่ง</strong><small>{employee.jobTitle || 'ยังไม่ระบุตำแหน่ง'}</small></button>
            {employee.isActive
              ? <button type="button" className={criticalAction === 'EMPLOYMENT_TERMINATION' ? 'is-active is-danger' : 'is-danger'} disabled={pendingReadOnly || busy} onClick={() => selectCriticalAction('EMPLOYMENT_TERMINATION')}><strong>ลาออก</strong><small>สิ้นสุดสถานะปฏิบัติงาน</small></button>
              : <button type="button" className={criticalAction === 'REHIRE' ? 'is-active' : ''} disabled={pendingReadOnly || busy} onClick={() => selectCriticalAction('REHIRE')}><strong>กลับเข้าทำงาน</strong><small>เปิดสถานะปฏิบัติงานอีกครั้ง</small></button>}
          </div>

          {criticalAction && <div className="employee-critical-editor">
            <header><div><strong>{criticalActionLabels[criticalAction]}</strong><span>กรอกข้อมูลใหม่และตรวจสอบผลกระทบก่อนบันทึก</span></div><button type="button" className="btn-neutral small-action" disabled={pendingReadOnly || busy} onClick={resetCriticalAction}>คืนค่าการเปลี่ยนแปลงนี้</button></header>
            {criticalAction === 'NAME_CHANGE' && <div className="employee-governed-grid">
              <label><span>ชื่อใหม่ <b>*</b></span><input required value={String(form.firstName || '')} disabled={pendingReadOnly} onChange={(event) => update('firstName', event.target.value)} /></label>
              <label><span>นามสกุลใหม่ <b>*</b></span><input required value={String(form.lastName || '')} disabled={pendingReadOnly} onChange={(event) => update('lastName', event.target.value)} /></label>
              <div className="employee-critical-before-after employee-governed-wide"><span>ปัจจุบัน <b>{employee.firstName} {employee.lastName}</b></span><span>หลังเปลี่ยน <b>{String(form.firstName || '')} {String(form.lastName || '')}</b></span></div>
            </div>}
            {criticalAction === 'DEPARTMENT_TRANSFER' && <div className="employee-governed-grid">
              <label className="employee-governed-wide"><span>หน่วยงานใหม่ <b>*</b></span><select required value={String(form.department || '')} disabled={pendingReadOnly || personnelMastersLoading || Boolean(personnelMastersError)} onChange={(event) => update('department', event.target.value)}><option value="">เลือก Department Master</option>{personnelMasters.departments.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select>{personnelMastersError && <small>{personnelMastersError}</small>}</label>
              <div className="employee-critical-before-after employee-governed-wide"><span>หน่วยงานเดิม <b>{employee.department || 'ไม่ระบุ'}</b></span><span>หน่วยงานใหม่ <b>{String(form.department || '') || 'ยังไม่ได้ระบุ'}</b></span></div>
              <small className="employee-governed-wide employee-critical-hint">ระบบจะตรวจเวรในอนาคต, ใบลา, Site/Department authority และบัญชีผู้ใช้ที่เชื่อมโยงก่อนยืนยัน</small>
            </div>}
            {criticalAction === 'POSITION_CHANGE' && <div className="employee-governed-grid">
              <label className="employee-governed-wide"><span>ตำแหน่งใหม่ <b>*</b></span><select required value={String(form.jobTitle || '')} disabled={pendingReadOnly || personnelMastersLoading || Boolean(personnelMastersError)} onChange={(event) => update('jobTitle', event.target.value)}><option value="">เลือก Position Master</option>{personnelMasters.positions.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select>{personnelMastersError && <small>{personnelMastersError}</small>}</label>
              <div className="employee-critical-before-after employee-governed-wide"><span>ตำแหน่งเดิม <b>{employee.jobTitle || 'ไม่ระบุ'}</b></span><span>ตำแหน่งใหม่ <b>{String(form.jobTitle || '') || 'ยังไม่ได้ระบุ'}</b></span></div>
              <small className="employee-governed-wide employee-critical-hint">การเปลี่ยนตำแหน่งอาจมีผลต่อสายอนุมัติและสิทธิ์ปฏิบัติงาน ระบบจะตรวจผลกระทบก่อนบันทึก</small>
            </div>}
            {(criticalAction === 'EMPLOYMENT_TERMINATION' || criticalAction === 'REHIRE') && <div className="employee-critical-before-after employee-critical-status-change"><span>สถานะเดิม <b>{employee.isActive ? 'ปฏิบัติงาน' : 'ลาออก'}</b></span><span>สถานะใหม่ <b>{criticalAction === 'EMPLOYMENT_TERMINATION' ? 'ลาออก' : 'ปฏิบัติงาน'}</b></span></div>}

            <div className="employee-governed-grid employee-critical-governance">
              <label><span>รูปแบบวันที่มีผล</span><select value={effectiveMode} disabled={pendingReadOnly} onChange={(event) => { setEffectiveMode(event.target.value as 'IMMEDIATE' | 'FUTURE_EFFECTIVE'); invalidate(); }}><option value="IMMEDIATE">มีผลทันที</option><option value="FUTURE_EFFECTIVE">กำหนดวันที่มีผล</option></select></label>
              {effectiveMode === 'FUTURE_EFFECTIVE' && <label><span>วันที่มีผล <b>*</b></span><input type="date" required value={effectiveDate} disabled={pendingReadOnly} onChange={(event) => { setEffectiveDate(event.target.value); invalidate(); }} /></label>}
              <label className="employee-governed-wide"><span>เหตุผล / หมายเหตุ <b>*</b></span><textarea rows={3} required={criticalReasonRequired} value={reason} disabled={pendingReadOnly} onChange={(event) => { setReason(event.target.value); invalidate(); }} /><small>การเปลี่ยนชื่อ ย้ายหน่วยงาน เปลี่ยนตำแหน่ง ลาออก และกลับเข้าทำงาน ต้องมีเหตุผลเพื่อบันทึก Audit</small></label>
            </div>
          </div>}

          {!criticalAction && <div className="employee-critical-empty"><strong>เลือกประเภทการเปลี่ยนแปลง</strong><span>เปลี่ยนชื่อ · ย้ายหน่วยงาน · เปลี่ยนตำแหน่ง · {employee.isActive ? 'ลาออก' : 'กลับเข้าทำงาน'}</span></div>}
        </section>
        <EmployeeReferencePhotoPanel token={token} employeeId={employee.id} role={role} onChanged={onChanged} />
        {isAdmin && preflight && <section className="employee-governed-section employee-impact"><h3>ผลกระทบก่อนบันทึก</h3><div className="employee-impact-grid"><span>เวรในอนาคต <b>{preflight.impacts.futureShiftAssignments || 0}</b></span><span>ลารอพิจารณา <b>{preflight.impacts.pendingLeaveRequests || 0}</b></span><span>ลาอนุมัติในอนาคต <b>{preflight.impacts.approvedFutureLeaveRequests || 0}</b></span><span>ใบอนุญาต <b>{preflight.impacts.activeLicenses || 0}</b></span></div>{preflight.warnings.map((warning) => <p key={warning.code}>⚠ {warning.message}{warning.count !== undefined ? ` (${warning.count})` : ''}</p>)}{preflight.warnings.length > 0 && <label className="employee-warning-confirm"><input type="checkbox" checked={acknowledgeWarnings} onChange={(event) => setAcknowledgeWarnings(event.target.checked)} /> ตรวจสอบคำเตือนแล้วและยืนยันดำเนินการ</label>}</section>}
        <section className="employee-governed-section"><h3>5. คำขอ / ประวัติการเปลี่ยนแปลง</h3>{loading ? <p>กำลังโหลดประวัติ…</p> : history.length ? <div className="employee-revision-list">{history.map(({ request, revision }) => <article key={`${request.id}-${revision.revision}`}><header><strong>Revision {revision.revision}</strong><span>{statusLabel[request.status] || request.status}</span></header><small>{revision.effectiveMode === 'FUTURE_EFFECTIVE' ? `มีผล ${cleanDate(revision.effectiveDate)}` : 'มีผลทันที'} · {new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(revision.submittedAt))}</small>{revisionCriticalLabels(revision.changedFields).length > 0 && <div className="employee-revision-actions">{revisionCriticalLabels(revision.changedFields).map((label) => <span key={label}>{label}</span>)}</div>}<div>{revision.changedFields.map((field) => <p key={field}><b>{labels[field] || field}</b><span>{display(field, revision.beforeSnapshot[field])} → {display(field, revision.afterSnapshot[field])}</span></p>)}</div>{revision.reason && <em>เหตุผล: {revision.reason}</em>}</article>)}</div> : <p className="employee-governed-empty">ยังไม่มีคำขอหรือ Revision ที่ส่งตรวจสอบ</p>}</section>
      </div>
      <footer className="employee-governed-actions"><button type="button" className="btn-neutral" onClick={onClose} disabled={busy}>ปิด</button>{isAdmin ? <><button type="button" className="btn-neutral" onClick={() => void runPreflight()} disabled={busy || !Object.keys(changes).length || criticalReasonMissing}>ตรวจสอบผลกระทบ</button><button type="button" className="btn-primary" onClick={() => void saveAdmin()} disabled={busy || !preflight || (preflight.warnings.length > 0 && !acknowledgeWarnings)}>บันทึกการแก้ไข</button></> : <>{activeRequest && activeStatuses.has(activeRequest.status) && <button type="button" className={cancelAction.className} onClick={() => void cancelRequest()} disabled={busy}>{cancelAction.label}</button>}{!pendingReadOnly && <button type="button" className={activeRequest?.status === 'RETURNED_FOR_CORRECTION' ? resubmitAction.className : 'btn-primary'} onClick={() => void submitManager()} disabled={busy || !Object.keys(changes).length || criticalReasonMissing}>{activeRequest?.status === 'RETURNED_FOR_CORRECTION' ? resubmitAction.label : 'ส่งคำขอแก้ไข'}</button>}</>}</footer>
    </section>
  </div>;
  return createPortal(modal, document.body);
}
