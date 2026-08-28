import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiRequestError } from '../../api';
import { acquireDocumentScrollLock } from '../../document-scroll-lock';
import { RequestErrorContent, toRequestErrorState, type RequestErrorInput } from '../../request-error';
import { approvalActionPresentation } from '../../approval-workflow-semantics';
import { SmsIcon } from '../SmsIcon';
import '../../styles/employee-governed-edit.css';

type Revision = { revision: number; beforeSnapshot: Record<string, unknown>; afterSnapshot: Record<string, unknown>; changedFields: string[]; effectiveMode: 'IMMEDIATE' | 'FUTURE_EFFECTIVE'; effectiveDate?: string | null; reason?: string | null; submittedAt: string; submittedBy?: { displayName?: string; role?: string } };
type Event = { action: string; metadata?: { impacts?: Record<string, number>; warningCodes?: string[] } | null };
type RequestRow = { id: string; status: string; currentRevision: number; employeeId: string; requestOwnerRoleSnapshot?: string; employee?: { employeeCode?: string; firstName?: string; lastName?: string; department?: string; jobTitle?: string }; requestOwner?: { displayName?: string; role?: string }; revisions?: Revision[]; events?: Event[]; createdAt?: string };
type Props = { token: string; initialRequestId?: string; onClose(): void; onChanged(): void };
const labels: Record<string, string> = { employeeCode: 'รหัสพนักงาน', firstName: 'ชื่อ', lastName: 'นามสกุล', department: 'หน่วยงาน', jobTitle: 'ตำแหน่ง', isActive: 'สถานะการทำงาน' };
const show = (field: string, value: unknown) => field === 'isActive' ? (value === true ? 'ACTIVE' : 'TERMINATED') : value === null || value === undefined || value === '' ? '—' : String(value);
const codeOf = (error: unknown) => error instanceof ApiRequestError && error.details && typeof error.details === 'object' && 'code' in error.details ? String((error.details as { code?: unknown }).code || '') : '';
const approveAction = approvalActionPresentation('APPROVE');
const returnAction = approvalActionPresentation('RETURN_FOR_CORRECTION');
const rejectAction = approvalActionPresentation('REJECT');

export function EmployeeChangeReviewModal({ token, initialRequestId, onClose, onChanged }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestErrorInput>();
  const [reviewComment, setReviewComment] = useState('');
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const selected = rows.find((row) => row.id === selectedId) || rows[0];
  const revision = useMemo(() => selected?.revisions?.find((item) => item.revision === selected.currentRevision) || (selected?.revisions && selected.revisions.length ? selected.revisions[selected.revisions.length - 1] : undefined), [selected]);
  const submitEvent = [...(selected?.events || [])].reverse().find((event) => ['SUBMIT', 'RESUBMIT'].includes(event.action));
  const impacts = submitEvent?.metadata?.impacts || {};
  const warningCodes = submitEvent?.metadata?.warningCodes || [];

  useEffect(() => {
    const release = acquireDocumentScrollLock();
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 0);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', key);
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', key); release(); previous?.focus({ preventScroll: true }); };
  }, [busy, onClose]);

  const load = async () => {
    setLoading(true); setError(undefined);
    try { const result = await api.employeeChangeRequestQueue(token); const data = Array.isArray(result?.data) ? result.data as RequestRow[] : []; setRows(data); setSelectedId((current) => data.some((row) => row.id === current) ? current : data.some((row) => row.id === initialRequestId) ? String(initialRequestId) : data[0]?.id || ''); }
    catch (cause) { setError(toRequestErrorState(cause, 'ไม่สามารถโหลดคิวคำขอแก้ไข Employee Master ได้')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [token, initialRequestId]);

  const act = async (action: 'approve' | 'return' | 'reject') => {
    if (!selected) return;
    if (action !== 'approve' && reviewComment.trim().length < 3) { setError(action === 'return' ? 'กรุณาระบุความเห็นสำหรับส่งกลับแก้ไข' : 'กรุณาระบุเหตุผลที่ไม่อนุมัติ'); return; }
    setBusy(true); setError(undefined);
    try {
      if (action === 'approve') await api.approveEmployeeChangeRequest(token, selected.id, crypto.randomUUID(), acknowledgeWarnings);
      else if (action === 'return') await api.returnEmployeeChangeRequest(token, selected.id, reviewComment.trim(), crypto.randomUUID());
      else await api.rejectEmployeeChangeRequest(token, selected.id, reviewComment.trim(), crypto.randomUUID());
      setReviewComment(''); setAcknowledgeWarnings(false); await load(); onChanged();
    } catch (cause) {
      const code = codeOf(cause);
      if (code === 'EMPLOYEE_CHANGE_STALE_MASTER') setError('ข้อมูล Employee Master มีการเปลี่ยนแปลงหลังจากส่งคำขอ โปรดส่งกลับให้ผู้ขอทบทวนข้อมูลล่าสุด');
      else if (code === 'EMPLOYEE_CHANGE_WARNINGS_REQUIRE_CONFIRMATION') setError('พบผลกระทบที่ต้องตรวจสอบ กรุณายืนยันคำเตือนก่อนอนุมัติ');
      else setError(toRequestErrorState(cause, 'ดำเนินการกับคำขอไม่สำเร็จ'));
    } finally { setBusy(false); }
  };

  return createPortal(<div className="employee-governed-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="employee-review-modal" role="dialog" aria-modal="true" aria-labelledby="employee-review-title">
      <header className="employee-governed-header"><div><p>ADMIN REVIEW · EMPLOYEE MASTER</p><h2 id="employee-review-title">คำขอแก้ไขข้อมูลพนักงาน</h2><span>คิวดำเนินการแสดงเฉพาะ PENDING_APPROVAL</span></div><button ref={closeRef} type="button" aria-label="ปิด" onClick={onClose} disabled={busy}><SmsIcon name="close" size={20} /></button></header>
      <div className="employee-review-layout">
        <aside className="employee-review-queue"><div className="employee-review-queue-title"><strong>รอตรวจสอบ</strong><span>{rows.length} รายการ</span></div>{loading ? <p>กำลังโหลด…</p> : rows.length ? rows.map((row) => <button type="button" key={row.id} className={selected?.id === row.id ? 'is-selected' : ''} onClick={() => { setSelectedId(row.id); setReviewComment(''); setError(undefined); }}><strong>{row.employee?.firstName} {row.employee?.lastName}</strong><span>{row.employee?.employeeCode} · Revision {row.currentRevision}</span><small>โดย {row.requestOwner?.displayName || 'Manager'}</small></button>) : <div className="employee-governed-empty">ไม่มีคำขอที่รออนุมัติ</div>}</aside>
        <div className="employee-review-detail">{error && <div className="employee-governed-alert employee-governed-alert--error"><RequestErrorContent error={error} /></div>}{selected && revision ? <>
          <section className="employee-review-summary"><div><small>พนักงาน</small><strong>{selected.employee?.firstName} {selected.employee?.lastName}</strong><span>{selected.employee?.employeeCode} · {selected.employee?.department || 'ไม่ระบุหน่วยงาน'}</span></div><div><small>ผู้ส่งคำขอ</small><strong>{selected.requestOwner?.displayName || 'Manager'}</strong><span>{selected.requestOwnerRoleSnapshot || selected.requestOwner?.role || 'MANAGER'} · Revision {revision.revision}</span><span>{new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(revision.submittedAt))}</span></div><div><small>สถานะ / วันที่มีผล</small><strong>{selected.status}</strong><span>{revision.effectiveMode === 'FUTURE_EFFECTIVE' ? `FUTURE_EFFECTIVE · ${String(revision.effectiveDate || '').slice(0, 10)}` : 'IMMEDIATE · เมื่ออนุมัติสำเร็จ'}</span></div></section>
          <section className="employee-review-diff"><h3>BEFORE → AFTER · เฉพาะข้อมูลที่เปลี่ยน</h3>{revision.changedFields.map((field: string) => <article key={field}><strong>{labels[field] || field}</strong><span>{show(field, revision.beforeSnapshot[field])}</span><i>→</i><span>{show(field, revision.afterSnapshot[field])}</span></article>)}{revision.reason && <p><b>เหตุผล:</b> {revision.reason}</p>}</section>
          <section className="employee-review-impact"><h3>ผลกระทบที่บันทึกตอนส่งคำขอ</h3><div className="employee-impact-grid"><span>เวรในอนาคต <b>{impacts.futureShiftAssignments || 0}</b></span><span>ลารอพิจารณา <b>{impacts.pendingLeaveRequests || 0}</b></span><span>ลาอนุมัติในอนาคต <b>{impacts.approvedFutureLeaveRequests || 0}</b></span><span>ใบอนุญาต <b>{impacts.activeLicenses || 0}</b></span></div>{warningCodes.length > 0 && <label className="employee-warning-confirm"><input type="checkbox" checked={acknowledgeWarnings} onChange={(event) => setAcknowledgeWarnings(event.target.checked)} /> ตรวจสอบผลกระทบแล้วและยืนยันอนุมัติ</label>}</section>
          <section className="employee-review-comment"><label><span>ความเห็น / เหตุผลสำหรับส่งกลับหรือไม่อนุมัติ</span><textarea rows={3} value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} placeholder="ระบุเมื่อส่งกลับแก้ไขหรือไม่อนุมัติ" /></label></section>
        </> : !loading && <div className="employee-governed-empty">เลือกรายการเพื่อดูรายละเอียด</div>}</div>
      </div>
      <footer className="employee-governed-actions"><button type="button" className="btn-neutral" onClick={onClose}>ปิด</button>{selected && <><button type="button" className={returnAction.className} disabled={busy || reviewComment.trim().length < 3} onClick={() => void act('return')}>{returnAction.label}</button><button type="button" className={rejectAction.className} disabled={busy || reviewComment.trim().length < 3} onClick={() => void act('reject')}>{rejectAction.label}</button><button type="button" className={approveAction.className} disabled={busy || (warningCodes.length > 0 && !acknowledgeWarnings)} onClick={() => void act('approve')}>{approveAction.label}</button></>}</footer>
    </section>
  </div>, document.body);
}
