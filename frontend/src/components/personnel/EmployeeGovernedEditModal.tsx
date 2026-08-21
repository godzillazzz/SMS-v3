import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiRequestError } from '../../api';
import { acquireDocumentScrollLock } from '../../document-scroll-lock';
import { RequestErrorContent, toRequestErrorState, type RequestErrorInput } from '../../request-error';
import { SmsIcon } from '../SmsIcon';
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
const activeStatuses = new Set(['DRAFT', 'PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION']);
const operationalFields = ['employeeCode', 'firstName', 'lastName', 'department', 'jobTitle', 'isActive'] as const;
const adminFields = [...operationalFields, 'email', 'phone', 'hiredAt', 'skill'] as const;
const labels: Record<string, string> = { employeeCode: 'รหัสพนักงาน', firstName: 'ชื่อ', lastName: 'นามสกุล', email: 'อีเมลติดต่อ', phone: 'โทรศัพท์', department: 'หน่วยงาน', jobTitle: 'ตำแหน่ง', hiredAt: 'วันที่เริ่มงาน', skill: 'ทักษะ/คุณสมบัติ', isActive: 'สถานะการทำงาน' };
const statusLabel: Record<string, string> = { DRAFT: 'ฉบับร่าง', PENDING_APPROVAL: 'รอ Admin อนุมัติ', RETURNED_FOR_CORRECTION: 'ส่งกลับให้แก้ไข', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิกแล้ว' };
const cleanDate = (value?: string | null) => value ? String(value).slice(0, 10) : '';
const display = (field: string, value: unknown) => field === 'isActive' ? (value === true ? 'ACTIVE' : 'TERMINATED') : value === null || value === undefined || value === '' ? '—' : String(value).slice(0, 10 + (field === 'hiredAt' ? 0 : 500));
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
      }
    } catch (cause) { setError(toRequestErrorState(cause, 'ไม่สามารถโหลดประวัติคำขอแก้ไขพนักงานได้')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadRequests(); }, [employee.id, token]);

  const changes = useMemo(() => {
    const next: Record<string, unknown> = {};
    for (const field of fields) {
      const original = field === 'department' || field === 'jobTitle' || field === 'email' || field === 'phone' || field === 'skill' ? (employee[field] || '') : field === 'hiredAt' ? cleanDate(employee.hiredAt) : employee[field];
      const current = form[field];
      if (String(current ?? '') !== String(original ?? '')) next[field] = field === 'isActive' ? Boolean(current) : current === '' ? null : current;
    }
    return next;
  }, [employee, fields, form]);

  const invalidate = () => { setPreflight(undefined); setAcknowledgeWarnings(false); setNotice(''); setError(undefined); };
  const update = (field: string, value: unknown) => { setForm((current) => ({ ...current, [field]: value })); invalidate(); };

  const runPreflight = async () => {
    if (!isAdmin || !Object.keys(changes).length) { if (!Object.keys(changes).length) setError('ยังไม่มีข้อมูลที่เปลี่ยนแปลง'); return; }
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
        {!isAdmin && activeRequest && <section className="employee-authoritative-context"><strong>ข้อมูล Employee Master ปัจจุบัน</strong><div><span>รหัส {employee.employeeCode}</span><span>{employee.firstName} {employee.lastName}</span><span>{employee.department || 'ไม่ระบุหน่วยงาน'}</span><span>{employee.jobTitle || 'ไม่ระบุตำแหน่ง'}</span><span>{employee.isActive ? 'ACTIVE' : 'TERMINATED'}</span></div><small>{activeRequest.status === 'PENDING_APPROVAL' ? 'ข้อเสนอที่ส่งแล้วแสดงแบบอ่านอย่างเดียวด้านล่าง' : activeRequest.status === 'RETURNED_FOR_CORRECTION' ? 'ฟอร์มด้านล่างเป็นข้อเสนอเดิมที่ส่งกลับมาให้แก้ไข โดย Revision ก่อนหน้ายังคงไม่เปลี่ยนแปลง' : 'ฟอร์มด้านล่างเป็นฉบับร่างที่ยังไม่ส่งตรวจสอบ'}</small></section>}
        {latestRequest?.status === 'APPROVED' && !latestRequest.appliedAt && latestRequest.revisions?.some((revision) => revision.effectiveMode === 'FUTURE_EFFECTIVE') && <div className="employee-request-banner employee-request-banner--approved"><strong>อนุมัติแล้ว · รอวันที่มีผล</strong></div>}
        {error && <div className="employee-governed-alert employee-governed-alert--error"><RequestErrorContent error={error} /></div>}
        {notice && <div className="employee-governed-alert employee-governed-alert--success">{notice}</div>}
        <section className="employee-governed-section"><h3>1. ข้อมูลพนักงาน</h3><div className="employee-governed-grid">
          <label><span>รหัสพนักงาน</span><input value={String(form.employeeCode || '')} disabled={pendingReadOnly} onChange={(event) => update('employeeCode', event.target.value)} /></label>
          <label><span>ชื่อ</span><input value={String(form.firstName || '')} disabled={pendingReadOnly} onChange={(event) => update('firstName', event.target.value)} /></label>
          <label><span>นามสกุล</span><input value={String(form.lastName || '')} disabled={pendingReadOnly} onChange={(event) => update('lastName', event.target.value)} /></label>
          {isAdmin && <><label><span>อีเมลติดต่อ</span><input type="email" value={String(form.email || '')} onChange={(event) => update('email', event.target.value)} /></label><label><span>โทรศัพท์</span><input value={String(form.phone || '')} onChange={(event) => update('phone', event.target.value)} /></label><label><span>วันที่เริ่มงาน</span><input type="date" value={String(form.hiredAt || '')} onChange={(event) => update('hiredAt', event.target.value)} /></label><label className="employee-governed-wide"><span>ทักษะ/คุณสมบัติ</span><input value={String(form.skill || '')} onChange={(event) => update('skill', event.target.value)} /></label></>}
        </div></section>
        <section className="employee-governed-section"><h3>2. ข้อมูลหน่วยงาน / ตำแหน่ง</h3><div className="employee-governed-grid"><label><span>หน่วยงาน</span><input value={String(form.department || '')} disabled={pendingReadOnly} onChange={(event) => update('department', event.target.value)} /></label><label><span>ตำแหน่ง</span><input value={String(form.jobTitle || '')} disabled={pendingReadOnly} onChange={(event) => update('jobTitle', event.target.value)} /></label></div></section>
        <section className="employee-governed-section"><h3>3. สถานะการทำงาน / วันที่มีผล</h3><div className="employee-governed-grid"><label><span>สถานะ</span><select value={form.isActive ? 'ACTIVE' : 'TERMINATED'} disabled={pendingReadOnly} onChange={(event) => update('isActive', event.target.value === 'ACTIVE')}><option value="ACTIVE">ACTIVE · ปฏิบัติงาน</option><option value="TERMINATED">TERMINATED · พ้นสภาพ</option></select></label><label><span>รูปแบบวันที่มีผล</span><select value={effectiveMode} disabled={pendingReadOnly} onChange={(event) => { setEffectiveMode(event.target.value as 'IMMEDIATE' | 'FUTURE_EFFECTIVE'); invalidate(); }}><option value="IMMEDIATE">มีผลทันที</option><option value="FUTURE_EFFECTIVE">กำหนดวันที่มีผล</option></select></label>{effectiveMode === 'FUTURE_EFFECTIVE' && <label><span>วันที่มีผล</span><input type="date" required value={effectiveDate} disabled={pendingReadOnly} onChange={(event) => { setEffectiveDate(event.target.value); invalidate(); }} /></label>}<label className="employee-governed-wide"><span>เหตุผล / หมายเหตุ</span><textarea rows={3} value={reason} disabled={pendingReadOnly} onChange={(event) => { setReason(event.target.value); invalidate(); }} /></label></div></section>
        {isAdmin && preflight && <section className="employee-governed-section employee-impact"><h3>ผลกระทบก่อนบันทึก</h3><div className="employee-impact-grid"><span>เวรในอนาคต <b>{preflight.impacts.futureShiftAssignments || 0}</b></span><span>ลารอพิจารณา <b>{preflight.impacts.pendingLeaveRequests || 0}</b></span><span>ลาอนุมัติในอนาคต <b>{preflight.impacts.approvedFutureLeaveRequests || 0}</b></span><span>ใบอนุญาต <b>{preflight.impacts.activeLicenses || 0}</b></span></div>{preflight.warnings.map((warning) => <p key={warning.code}>⚠ {warning.message}{warning.count !== undefined ? ` (${warning.count})` : ''}</p>)}{preflight.warnings.length > 0 && <label className="employee-warning-confirm"><input type="checkbox" checked={acknowledgeWarnings} onChange={(event) => setAcknowledgeWarnings(event.target.checked)} /> ตรวจสอบคำเตือนแล้วและยืนยันดำเนินการ</label>}</section>}
        <section className="employee-governed-section"><h3>4. คำขอ / ประวัติการเปลี่ยนแปลง</h3>{loading ? <p>กำลังโหลดประวัติ…</p> : history.length ? <div className="employee-revision-list">{history.map(({ request, revision }) => <article key={`${request.id}-${revision.revision}`}><header><strong>Revision {revision.revision}</strong><span>{statusLabel[request.status] || request.status}</span></header><small>{revision.effectiveMode === 'FUTURE_EFFECTIVE' ? `มีผล ${cleanDate(revision.effectiveDate)}` : 'มีผลทันที'} · {new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(revision.submittedAt))}</small><div>{revision.changedFields.map((field) => <p key={field}><b>{labels[field] || field}</b><span>{display(field, revision.beforeSnapshot[field])} → {display(field, revision.afterSnapshot[field])}</span></p>)}</div>{revision.reason && <em>เหตุผล: {revision.reason}</em>}</article>)}</div> : <p className="employee-governed-empty">ยังไม่มีคำขอหรือ Revision ที่ส่งตรวจสอบ</p>}</section>
      </div>
      <footer className="employee-governed-actions"><button type="button" className="btn-neutral" onClick={onClose} disabled={busy}>ปิด</button>{isAdmin ? <><button type="button" className="btn-neutral" onClick={() => void runPreflight()} disabled={busy || !Object.keys(changes).length}>ตรวจสอบผลกระทบ</button><button type="button" className="btn-primary" onClick={() => void saveAdmin()} disabled={busy || !preflight || (preflight.warnings.length > 0 && !acknowledgeWarnings)}>บันทึกการแก้ไข</button></> : <>{activeRequest && activeStatuses.has(activeRequest.status) && <button type="button" className="btn-danger-outline" onClick={() => void cancelRequest()} disabled={busy}>ยกเลิกคำขอ</button>}{!pendingReadOnly && <button type="button" className="btn-primary" onClick={() => void submitManager()} disabled={busy || !Object.keys(changes).length}>{activeRequest?.status === 'RETURNED_FOR_CORRECTION' ? 'แก้ไขและส่งใหม่' : 'ส่งคำขอแก้ไข'}</button>}</>}</footer>
    </section>
  </div>;
  return createPortal(modal, document.body);
}