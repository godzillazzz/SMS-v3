import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { RequestErrorContent, toRequestErrorState, type RequestErrorInput } from '../../request-error';
import { SmsIcon } from '../SmsIcon';
import { ATTACHMENT_POLICIES } from '../../lib/attachment-optimizer';
import type { PersonnelRole } from './types';
import '../../styles/employee-reference-photo.css';

type ReferencePhoto = {
  id: string; employeeId: string; status: 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'CANCELLED' | 'SUPERSEDED';
  fileName: string; mimeType: string; fileSize: number; imageWidth: number; imageHeight: number; uploadedByRoleSnapshot: string;
  uploadedAt: string; reviewedAt?: string | null; rejectionReason?: string | null; activatedAt?: string | null; supersededAt?: string | null;
  cancelledAt?: string | null; storageDeletedAt?: string | null; cleanupPending?: boolean;
  uploadedBy?: { id: string; displayName?: string | null }; reviewedBy?: { id: string; displayName?: string | null };
};
type State = { employeeId: string; activePhoto: ReferencePhoto | null; pendingPhoto: ReferencePhoto | null; history: ReferencePhoto[] };
type Props = { token: string; employeeId: string; role: PersonnelRole; onChanged?(): void };

const fmt = (value?: string | null) => value ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value)) : '—';
const fileSize = (value: number) => value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;

export function EmployeeReferencePhotoPanel({ token, employeeId, role, onChanged }: Props) {
  const isAdmin = role === 'ADMIN';
  const [state, setState] = useState<State>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestErrorInput>();
  const [notice, setNotice] = useState('');
  const [file, setFile] = useState<File>();
  const [activeUrl, setActiveUrl] = useState('');
  const [pendingUrl, setPendingUrl] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [ackDeleteOld, setAckDeleteOld] = useState(false);
  const localPreview = useMemo(() => file ? URL.createObjectURL(file) : '', [file]);

  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);

  const signedUrl = async (photo?: ReferencePhoto | null) => {
    if (!photo) return '';
    try { return String((await api.viewEmployeeReferencePhoto(token, photo.id))?.data?.url || ''); } catch { return ''; }
  };
  const load = async () => {
    setLoading(true); setError(undefined);
    try {
      const result = await api.employeeReferencePhotos(token, employeeId);
      const next = result.data as State; setState(next);
      const [a, p] = await Promise.all([signedUrl(next.activePhoto), signedUrl(next.pendingPhoto)]);
      setActiveUrl(a); setPendingUrl(p);
    } catch (cause) { setError(toRequestErrorState(cause, 'ไม่สามารถอ่านรูปอ้างอิงพนักงานได้')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [employeeId, token]);

  const chooseFile = (next?: File) => {
    setNotice(''); setError(undefined); setAckDeleteOld(false);
    if (!next) { setFile(undefined); return; }
    if (!['image/jpeg', 'image/png'].includes(next.type)) { setError('รองรับเฉพาะไฟล์ JPEG หรือ PNG'); return; }
    if (next.size > ATTACHMENT_POLICIES.EMPLOYEE_REFERENCE_PHOTO.maxSourceBytes) { setError('รูปต้นฉบับมีขนาดใหญ่เกิน 12 MB กรุณาเลือกภาพอื่น'); return; }
    setFile(next);
  };
  const upload = async () => {
    if (!file || state?.pendingPhoto) return;
    if (isAdmin && state?.activePhoto && !ackDeleteOld) { setError('กรุณายืนยันว่ารูป ACTIVE เดิมจะถูกลบทันทีหลังรูปใหม่เปิดใช้งานสำเร็จ'); return; }
    setBusy(true); setError(undefined); setNotice('');
    try {
      const result = await api.uploadEmployeeReferencePhoto(token, employeeId, file);
      const cleanupPending = Boolean(result?.data?.cleanup?.pending);
      setNotice(isAdmin ? (cleanupPending ? 'เปิดใช้งานรูปใหม่แล้ว แต่การลบไฟล์เดิมอยู่ระหว่าง retry แบบปิดการเข้าถึง' : 'เปิดใช้งานรูปอ้างอิงใหม่แล้ว และเริ่มลบรูปเดิมตาม Retention A') : 'ส่งรูปใหม่ให้ Admin ตรวจสอบแล้ว รูป ACTIVE เดิมยังคงใช้เป็นข้อมูลอ้างอิง');
      setFile(undefined); setAckDeleteOld(false); await load(); onChanged?.();
    } catch (cause) { setError(toRequestErrorState(cause, 'บันทึกรูปอ้างอิงไม่สำเร็จ')); }
    finally { setBusy(false); }
  };
  const approve = async () => {
    const pending = state?.pendingPhoto; if (!isAdmin || !pending) return;
    setBusy(true); setError(undefined); setNotice('');
    try { const result = await api.approveEmployeeReferencePhoto(token, pending.id); setNotice(result?.data?.cleanup?.pending ? 'อนุมัติรูปใหม่แล้ว การลบรูป ACTIVE เดิมอยู่ระหว่าง retry แบบปิดการเข้าถึง' : 'อนุมัติรูปใหม่แล้ว และลบรูป ACTIVE เดิมตาม Retention A'); setRejectReason(''); await load(); onChanged?.(); }
    catch (cause) { setError(toRequestErrorState(cause, 'อนุมัติรูปอ้างอิงไม่สำเร็จ')); } finally { setBusy(false); }
  };
  const reject = async () => {
    const pending = state?.pendingPhoto; if (!isAdmin || !pending || rejectReason.trim().length < 3) return;
    setBusy(true); setError(undefined); setNotice('');
    try { await api.rejectEmployeeReferencePhoto(token, pending.id, rejectReason.trim()); setNotice('ไม่อนุมัติรูปที่เสนอและเริ่มลบไฟล์ candidate แล้ว'); setRejectReason(''); await load(); onChanged?.(); }
    catch (cause) { setError(toRequestErrorState(cause, 'ไม่สามารถปฏิเสธรูปอ้างอิงได้')); } finally { setBusy(false); }
  };
  const cancel = async () => {
    const pending = state?.pendingPhoto; if (isAdmin || !pending) return;
    setBusy(true); setError(undefined); setNotice('');
    try { await api.cancelEmployeeReferencePhoto(token, pending.id); setNotice('ยกเลิกรูปที่เสนอและเริ่มลบไฟล์ candidate แล้ว'); await load(); onChanged?.(); }
    catch (cause) { setError(toRequestErrorState(cause, 'ยกเลิกคำขอรูปอ้างอิงไม่สำเร็จ')); } finally { setBusy(false); }
  };

  const active = state?.activePhoto; const pending = state?.pendingPhoto;
  return <section className="employee-governed-section employee-reference-photo-section" aria-labelledby="employee-reference-photo-title">
    <div className="reference-photo-heading"><div><h3 id="employee-reference-photo-title">4. รูปอ้างอิงพนักงาน</h3><p>ใช้เป็นภาพอ้างอิงสำหรับ 1:1 Face Verification เท่านั้น · ไม่ใช่รูป Attendance Event</p></div><span className="reference-photo-policy"><SmsIcon name="shield" size={16} />Retention A</span></div>
    {error && <div className="employee-governed-alert employee-governed-alert--error"><RequestErrorContent error={error} /></div>}
    {notice && <div className="employee-governed-alert employee-governed-alert--success">{notice}</div>}
    {loading ? <div className="reference-photo-loading">กำลังอ่านสถานะรูปอ้างอิง…</div> : <div className="reference-photo-layout">
      <article className="reference-photo-card"><header><div><strong>รูป ACTIVE ปัจจุบัน</strong><span>{active ? `เปิดใช้ ${fmt(active.activatedAt)}` : 'ยังไม่มีรูปอ้างอิง'}</span></div>{active && <span className="status-badge active">ACTIVE</span>}</header>
        <div className="reference-photo-frame">{activeUrl ? <img src={activeUrl} alt="รูปอ้างอิงพนักงานปัจจุบัน" /> : <div className="reference-photo-placeholder"><SmsIcon name="employees" size={30} /><span>{active ? 'ไม่สามารถเปิดรูปชั่วคราว' : 'ยังไม่มีรูป ACTIVE'}</span></div>}</div>
        {active && <dl><div><dt>ไฟล์</dt><dd>{active.fileName}</dd></div><div><dt>ขนาด</dt><dd>{active.imageWidth}×{active.imageHeight} · {fileSize(active.fileSize)}</dd></div><div><dt>อนุมัติ/เปิดใช้</dt><dd>{active.reviewedBy?.displayName || active.uploadedBy?.displayName || 'Admin'}</dd></div></dl>}
      </article>
      <article className="reference-photo-card"><header><div><strong>{pending ? 'รูปที่รอพิจารณา' : isAdmin ? 'เปลี่ยนรูปอ้างอิง' : 'เสนอรูปอ้างอิงใหม่'}</strong><span>{pending ? `ส่งเมื่อ ${fmt(pending.uploadedAt)}` : isAdmin ? 'Admin เปิดใช้งานรูปใหม่โดยตรง' : 'รูปเดิมยัง ACTIVE จนกว่า Admin อนุมัติ'}</span></div>{pending && <span className="status-badge pending">PENDING</span>}</header>
        {pending ? <><div className="reference-photo-frame reference-photo-frame--candidate">{pendingUrl ? <img src={pendingUrl} alt="รูปอ้างอิงที่รอพิจารณา" /> : <div className="reference-photo-placeholder"><SmsIcon name="eye" size={28} /><span>ไม่สามารถเปิด candidate ชั่วคราว</span></div>}</div><dl><div><dt>ผู้เสนอ</dt><dd>{pending.uploadedBy?.displayName || 'Manager'}</dd></div><div><dt>ขนาด</dt><dd>{pending.imageWidth}×{pending.imageHeight} · {fileSize(pending.fileSize)}</dd></div></dl>
          {isAdmin ? <div className="reference-photo-review"><button type="button" className="btn-primary" disabled={busy} onClick={() => void approve()}><SmsIcon name="check" size={16} />อนุมัติและเปิดใช้</button><label><span>เหตุผลที่ไม่อนุมัติ</span><textarea rows={2} value={rejectReason} maxLength={1000} onChange={(event) => setRejectReason(event.target.value)} /></label><button type="button" className="btn-danger-outline" disabled={busy || rejectReason.trim().length < 3} onClick={() => void reject()}>ไม่อนุมัติ</button></div> : <button type="button" className="btn-danger-outline" disabled={busy} onClick={() => void cancel()}>ยกเลิกรูปที่เสนอ</button>}
        </> : <div className="reference-photo-upload"><div className="reference-photo-frame">{localPreview ? <img src={localPreview} alt="ตัวอย่างรูปใหม่ก่อนอัปโหลด" /> : <div className="reference-photo-placeholder"><SmsIcon name="plus" size={28} /><span>เลือก JPEG/PNG · ระบบปรับอัตโนมัติ เป้าหมาย 400–700 KB</span></div>}</div><label className="reference-photo-file"><span>ไฟล์รูปอ้างอิง</span><input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={(event) => chooseFile(event.target.files?.[0])} /></label>
          {isAdmin && active && <label className="reference-photo-delete-ack"><input type="checkbox" checked={ackDeleteOld} onChange={(event) => setAckDeleteOld(event.target.checked)} /><span>ยืนยันว่าเมื่อรูปใหม่ ACTIVE สำเร็จ ระบบจะลบไฟล์รูปเดิมทันทีตาม Retention A</span></label>}
          <button type="button" className="btn-primary" disabled={busy || !file || Boolean(isAdmin && active && !ackDeleteOld)} onClick={() => void upload()}><SmsIcon name="plus" size={16} />{busy ? 'กำลังบันทึก…' : isAdmin ? 'เปิดใช้รูปใหม่นี้' : 'ส่งให้ Admin ตรวจสอบ'}</button></div>}
      </article>
    </div>}
    <p className="reference-photo-footnote">Live face/liveness frames และรูป Check-in/Check-out/Patrol ไม่ถูกเก็บใน V1 ส่วน persistent biometric templates/embeddings ยังไม่อยู่ใน scope นี้</p>
  </section>;
}
