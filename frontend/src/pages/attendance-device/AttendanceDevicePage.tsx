import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { SmsIcon } from '../../components/SmsIcon';
import {
  ATTENDANCE_DEVICE_KEY_ALGORITHM,
  attendanceDeviceCapability,
  deleteAttendanceDeviceKey,
  generateAttendanceDeviceKeyPair,
  getAttendanceDeviceKey,
  pruneAttendanceDeviceKeys,
  signAttendanceDeviceChallenge,
  storeAttendanceDevicePrivateKey
} from '../../lib/attendance-device-key';

export type AttendanceDeviceEnrollment = {
  id: string;
  employeeId: string;
  displayName: string;
  keyAlgorithm: string;
  credentialFingerprint?: string;
  platformHint?: string | null;
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'REVOKED' | 'REJECTED' | 'CANCELLED';
  proofVerifiedAt?: string | null;
  enrolledAt?: string | null;
  activatedAt?: string | null;
  revokedAt?: string | null;
};

export type AttendanceDeviceRequest = {
  id: string;
  employeeId: string;
  requestType: 'INITIAL' | 'REPLACEMENT';
  status: 'PENDING_APPROVAL' | 'RETURNED_FOR_CORRECTION' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requestedByUserId: string;
  candidateDeviceEnrollmentId: string;
  currentDeviceEnrollmentId?: string | null;
  reason?: string | null;
  reviewerComment?: string | null;
  reviewedAt?: string | null;
  returnedAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  candidateDevice?: AttendanceDeviceEnrollment;
  employee?: { id: string; displayName?: string | null; firstName?: string | null; lastName?: string | null; department?: string | null };
  requestedBy?: { id: string; displayName?: string | null };
};

type SelfState = {
  employeeId: string;
  activeDevice: AttendanceDeviceEnrollment | null;
  activeRequest: AttendanceDeviceRequest | null;
};

type Props = { token: string; role: string; readOnly?: boolean };

type ReviewAction = 'RETURN' | 'REJECT';
type ReviewTarget = { row: AttendanceDeviceRequest; action: ReviewAction } | null;

const formatDate = (value?: string | null) => value
  ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value))
  : '—';

const statusLabel: Record<AttendanceDeviceRequest['status'], string> = {
  PENDING_APPROVAL: 'รอ Admin อนุมัติ',
  RETURNED_FOR_CORRECTION: 'ส่งกลับให้แก้ไข',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิกแล้ว'
};

const statusClass: Record<AttendanceDeviceRequest['status'], string> = {
  PENDING_APPROVAL: 'pending',
  RETURNED_FOR_CORRECTION: 'returned',
  APPROVED: 'active',
  REJECTED: 'inactive',
  CANCELLED: 'muted'
};

function employeeName(row: AttendanceDeviceRequest) {
  const employee = row.employee;
  return employee?.displayName?.trim() || [employee?.firstName, employee?.lastName].filter(Boolean).join(' ') || 'พนักงาน';
}

function capabilityMessage(reason?: string) {
  if (reason === 'SECURE_CONTEXT_REQUIRED') return 'การลงทะเบียนอุปกรณ์ต้องเปิดผ่าน HTTPS เพื่อใช้ Web Crypto อย่างปลอดภัย';
  if (reason === 'WEB_CRYPTO_UNAVAILABLE') return 'เบราว์เซอร์นี้ไม่รองรับ Web Crypto ที่ระบบต้องใช้';
  if (reason === 'INDEXED_DB_UNAVAILABLE') return 'เบราว์เซอร์นี้ไม่อนุญาตพื้นที่เก็บคีย์ของอุปกรณ์';
  return 'อุปกรณ์หรือเบราว์เซอร์นี้ยังไม่พร้อมสำหรับการลงทะเบียน';
}

export function AttendanceDevicePage({ token, role, readOnly = false }: Props) {
  const capability = useMemo(() => attendanceDeviceCapability(), []);
  const [selfState, setSelfState] = useState<SelfState | null>(null);
  const [selfLoading, setSelfLoading] = useState(true);
  const [selfError, setSelfError] = useState<string>();
  const [queue, setQueue] = useState<AttendanceDeviceRequest[]>([]);
  const [queueLoading, setQueueLoading] = useState(role === 'ADMIN');
  const [queueError, setQueueError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [displayName, setDisplayName] = useState('โทรศัพท์ลงเวลาของฉัน');
  const [reason, setReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [localKeyPresent, setLocalKeyPresent] = useState<boolean | null>(null);
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget>(null);
  const [reviewReason, setReviewReason] = useState('');

  const loadSelf = async () => {
    setSelfLoading(true); setSelfError(undefined);
    try {
      const response = await api.attendanceDeviceState(token);
      const next = response.data as SelfState;
      setSelfState(next);
      if (capability.supported) {
        const allowedIds = [next.activeDevice?.id, next.activeRequest?.candidateDeviceEnrollmentId].filter(Boolean) as string[];
        await pruneAttendanceDeviceKeys(next.employeeId, allowedIds).catch(() => undefined);
      }
      if (next.activeRequest?.candidateDeviceEnrollmentId && capability.supported) {
        try { setLocalKeyPresent(Boolean(await getAttendanceDeviceKey(next.activeRequest.candidateDeviceEnrollmentId))); }
        catch { setLocalKeyPresent(false); }
      } else {
        setLocalKeyPresent(null);
      }
    } catch (error) {
      setSelfState(null);
      setLocalKeyPresent(null);
      setSelfError(error instanceof Error ? error.message : 'ไม่สามารถอ่านสถานะอุปกรณ์ลงเวลาได้');
    } finally { setSelfLoading(false); }
  };

  const loadQueue = async () => {
    if (role !== 'ADMIN') return;
    setQueueLoading(true); setQueueError(undefined);
    try { setQueue((await api.attendanceDeviceRequests(token)).data || []); }
    catch (error) { setQueueError(error instanceof Error ? error.message : 'ไม่สามารถอ่านคิวอนุมัติอุปกรณ์ได้'); }
    finally { setQueueLoading(false); }
  };

  const refresh = async () => { await Promise.allSettled([loadSelf(), loadQueue()]); };

  useEffect(() => { void refresh(); }, [token, role]);

  const proveRequest = async (request: AttendanceDeviceRequest) => {
    const candidateId = request.candidateDeviceEnrollmentId;
    const options = (await api.attendanceDeviceProofOptions(token, request.id)).data;
    const signatureBase64 = await signAttendanceDeviceChallenge(candidateId, options.challenge);
    await api.verifyAttendanceDeviceProof(token, request.id, { challengeId: options.challengeId, challenge: options.challenge, signatureBase64 });
  };

  const enroll = async () => {
    if (readOnly) return;
    setMessage(undefined); setSelfError(undefined);
    if (!capability.supported) { setSelfError(capabilityMessage(capability.reason)); return; }
    const name = displayName.trim();
    if (!name) { setSelfError('กรุณาระบุชื่ออุปกรณ์'); return; }
    if (selfState?.activeDevice && !reason.trim()) { setSelfError('การขอเปลี่ยนอุปกรณ์ต้องระบุเหตุผลเพื่อให้ Admin ใช้ประกอบการพิจารณา'); return; }
    setBusy(true);
    let created: AttendanceDeviceRequest | null = null;
    try {
      const material = await generateAttendanceDeviceKeyPair();
      created = (await api.createAttendanceDeviceRequest(token, {
        displayName: name,
        publicKeySpkiBase64: material.publicKeySpkiBase64,
        keyAlgorithm: ATTENDANCE_DEVICE_KEY_ALGORITHM,
        platformHint: navigator.platform || 'Web',
        reason: reason.trim() || null
      })).data as AttendanceDeviceRequest;
      try {
        await storeAttendanceDevicePrivateKey(created.candidateDeviceEnrollmentId, created.employeeId, material.privateKey, material.publicKeySpkiBase64);
      } catch (storageError) {
        await api.cancelAttendanceDeviceRequest(token, created.id, 'LOCAL_KEY_STORAGE_FAILED').catch(() => undefined);
        throw storageError;
      }
      await proveRequest(created);
      setMessage(created.requestType === 'INITIAL'
        ? 'ยืนยันคีย์ของอุปกรณ์สำเร็จ ส่งคำขอเครื่องแรกให้ Admin อนุมัติแล้ว'
        : 'ยืนยันคีย์ของอุปกรณ์ใหม่สำเร็จ ส่งคำขอเปลี่ยนอุปกรณ์ให้ Admin อนุมัติแล้ว');
      setReason('');
      await refresh();
    } catch (error) {
      setSelfError(error instanceof Error ? error.message : 'ลงทะเบียนอุปกรณ์ไม่สำเร็จ');
      await loadSelf();
    } finally { setBusy(false); }
  };

  const retryProof = async () => {
    if (!selfState?.activeRequest || readOnly) return;
    setBusy(true); setSelfError(undefined); setMessage(undefined);
    try {
      await proveRequest(selfState.activeRequest);
      setMessage('ยืนยันคีย์ของอุปกรณ์สำเร็จแล้ว คำขอพร้อมให้ Admin พิจารณา');
      await refresh();
    } catch (error) { setSelfError(error instanceof Error ? error.message : 'ยืนยันคีย์ของอุปกรณ์ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const cancelRequest = async () => {
    const request = selfState?.activeRequest;
    if (!request || readOnly) return;
    if (!cancelReason.trim()) { setSelfError('กรุณาระบุเหตุผลที่ยกเลิกคำขอ'); return; }
    setBusy(true); setSelfError(undefined); setMessage(undefined);
    try {
      await api.cancelAttendanceDeviceRequest(token, request.id, cancelReason.trim());
      await deleteAttendanceDeviceKey(request.candidateDeviceEnrollmentId).catch(() => undefined);
      setCancelReason(''); setMessage('ยกเลิกคำขออุปกรณ์แล้ว');
      await refresh();
    } catch (error) { setSelfError(error instanceof Error ? error.message : 'ยกเลิกคำขอไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const resubmit = async () => {
    const request = selfState?.activeRequest;
    if (!request || request.status !== 'RETURNED_FOR_CORRECTION' || readOnly) return;
    setBusy(true); setSelfError(undefined); setMessage(undefined);
    try {
      await api.resubmitAttendanceDeviceRequest(token, request.id, reason.trim() || request.reason || null);
      setMessage('ส่งคำขอให้ Admin พิจารณาอีกครั้งแล้ว');
      await refresh();
    } catch (error) { setSelfError(error instanceof Error ? error.message : 'ส่งคำขออีกครั้งไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const approve = async (row: AttendanceDeviceRequest) => {
    if (readOnly || role !== 'ADMIN') return;
    if (!row.candidateDevice?.proofVerifiedAt) { setQueueError('ยังอนุมัติไม่ได้: อุปกรณ์นี้ยังไม่ผ่านการพิสูจน์ possession ของ private key'); return; }
    if (!window.confirm(`ยืนยันอนุมัติ ${employeeName(row)} · ${row.candidateDevice.displayName}?`)) return;
    setBusy(true); setQueueError(undefined); setMessage(undefined);
    try { await api.approveAttendanceDeviceRequest(token, row.id); setMessage('อนุมัติอุปกรณ์ลงเวลาแล้ว'); await refresh(); }
    catch (error) { setQueueError(error instanceof Error ? error.message : 'อนุมัติอุปกรณ์ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const submitReview = async () => {
    if (!reviewTarget || readOnly || role !== 'ADMIN') return;
    const text = reviewReason.trim();
    if (text.length < 3) { setQueueError('กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร'); return; }
    setBusy(true); setQueueError(undefined); setMessage(undefined);
    try {
      if (reviewTarget.action === 'RETURN') await api.returnAttendanceDeviceRequest(token, reviewTarget.row.id, text);
      else await api.rejectAttendanceDeviceRequest(token, reviewTarget.row.id, text);
      setMessage(reviewTarget.action === 'RETURN' ? 'ส่งคำขอกลับให้พนักงานแก้ไขแล้ว' : 'ไม่อนุมัติคำขออุปกรณ์แล้ว');
      setReviewTarget(null); setReviewReason('');
      await refresh();
    } catch (error) { setQueueError(error instanceof Error ? error.message : 'บันทึกผลพิจารณาไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const request = selfState?.activeRequest;
  const activeDevice = selfState?.activeDevice;
  const isReplacement = Boolean(activeDevice);
  const proofReady = Boolean(request?.candidateDevice?.proofVerifiedAt);

  return <section className="view-pane attendance-device-page">
    <div className="page-heading attendance-device-heading">
      <div><p className="eyebrow">G06 · PERSONAL DEVICE</p><h1>อุปกรณ์ลงเวลา</h1><p>ผูกอุปกรณ์หลักกับ Employee แบบ 1 คน = 1 เครื่อง โดยเครื่องแรกและการเปลี่ยนเครื่องต้อง Admin อนุมัติ</p></div>
      <div className="heading-actions"><button type="button" className="btn-neutral small-action" disabled={busy} onClick={() => void refresh()}><SmsIcon name="refresh" size={17} />รีเฟรช</button></div>
    </div>

    {readOnly && <div className="settings-notice">กำลังอยู่ใน View As — หน้านี้เป็นแบบอ่านอย่างเดียวและไม่อนุญาตให้ลงทะเบียนหรืออนุมัติอุปกรณ์</div>}
    {!capability.supported && <div className="alert alert-error">{capabilityMessage(capability.reason)}</div>}
    {message && <div className="settings-notice success" role="status">{message}</div>}

    <div className="attendance-device-grid">
      <article className="attendance-device-card attendance-device-card--primary">
        <header><span className="attendance-device-card__icon"><SmsIcon name="key" size={21} /></span><div><h2>อุปกรณ์หลักของฉัน</h2><p>Private key อยู่เฉพาะใน browser storage ของอุปกรณ์นี้ และส่งออกไม่ได้</p></div></header>
        {selfLoading ? <div className="attendance-device-state">กำลังอ่านสถานะอุปกรณ์…</div>
          : activeDevice ? <div className="attendance-device-current">
            <div className="attendance-device-current__hero"><span className="device-orb"><SmsIcon name="check" size={22} /></span><div><strong>{activeDevice.displayName}</strong><span>ACTIVE · ใช้เป็นอุปกรณ์หลักสำหรับ Attendance/Patrol</span></div></div>
            <dl><div><dt>เปิดใช้งาน</dt><dd>{formatDate(activeDevice.activatedAt)}</dd></div><div><dt>แพลตฟอร์ม</dt><dd>{activeDevice.platformHint || 'Web'}</dd></div><div><dt>Key</dt><dd>{activeDevice.keyAlgorithm}</dd></div></dl>
          </div> : !selfError ? <div className="attendance-device-state attendance-device-state--empty"><strong>ยังไม่มีอุปกรณ์หลัก</strong><span>ลงทะเบียนจากโทรศัพท์หรืออุปกรณ์ที่ต้องการใช้ลงเวลา แล้วรอ Admin อนุมัติ</span></div> : null}
        {selfError && <div className="alert alert-error" role="alert">{selfError}</div>}
      </article>

      <article className="attendance-device-card">
        <header><span className="attendance-device-card__icon"><SmsIcon name="shield" size={21} /></span><div><h2>{request ? 'คำขอที่กำลังดำเนินการ' : isReplacement ? 'ขอเปลี่ยนอุปกรณ์' : 'ลงทะเบียนอุปกรณ์เครื่องแรก'}</h2><p>บัญชี/Passkey ไม่ถือเป็นหลักฐานว่าเครื่องนี้เป็น Attendance device จนกว่า Admin จะอนุมัติ</p></div></header>
        {request ? <div className="attendance-device-request">
          <div className="attendance-device-request__top"><div><strong>{request.candidateDevice?.displayName || 'Candidate device'}</strong><span>{request.requestType === 'INITIAL' ? 'เครื่องแรก' : 'เปลี่ยนอุปกรณ์'}</span></div><span className={`status-badge ${statusClass[request.status]}`}>{statusLabel[request.status]}</span></div>
          <div className={`device-proof-state ${proofReady ? 'is-ready' : 'is-warning'}`}><SmsIcon name={proofReady ? 'check' : 'key'} size={18} /><div><strong>{proofReady ? 'Device proof ผ่านแล้ว' : 'ยังต้องยืนยันคีย์ของอุปกรณ์'}</strong><span>{proofReady ? `พิสูจน์เมื่อ ${formatDate(request.candidateDevice?.proofVerifiedAt)}` : localKeyPresent === false ? 'ไม่พบ private key ของ candidate นี้ใน browser ปัจจุบัน' : 'กด “ยืนยันคีย์อีกครั้ง” จากอุปกรณ์เดิมก่อนให้ Admin อนุมัติ'}</span></div></div>
          {request.reason && <p className="attendance-device-reason"><b>เหตุผล:</b> {request.reason}</p>}
          {request.reviewerComment && <div className="attendance-device-review-note"><b>ความเห็นผู้ตรวจ:</b><span>{request.reviewerComment}</span></div>}
          {request.status === 'RETURNED_FOR_CORRECTION' && <label className="attendance-device-field"><span>เหตุผล/คำชี้แจงสำหรับส่งใหม่</span><textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder={request.reason || 'ระบุคำชี้แจงเพิ่มเติม'} /></label>}
          {!proofReady && localKeyPresent !== false && <button type="button" className="btn-primary" disabled={busy || readOnly || !capability.supported} onClick={() => void retryProof()}><SmsIcon name="key" size={17} />{busy ? 'กำลังยืนยัน…' : 'ยืนยันคีย์อีกครั้ง'}</button>}
          {request.status === 'RETURNED_FOR_CORRECTION' && <button type="button" className="btn-primary" disabled={busy || readOnly} onClick={() => void resubmit()}><SmsIcon name="refresh" size={17} />ส่งให้ Admin พิจารณาอีกครั้ง</button>}
          <div className="attendance-device-cancel"><label className="attendance-device-field"><span>เหตุผลที่ยกเลิกคำขอ</span><input value={cancelReason} maxLength={1000} onChange={(event) => setCancelReason(event.target.value)} placeholder="เช่น เลือกอุปกรณ์ผิด / ต้องการลงทะเบียนใหม่" /></label><button type="button" className="btn-danger-outline" disabled={busy || readOnly || !cancelReason.trim()} onClick={() => void cancelRequest()}>ยกเลิกคำขอนี้</button></div>
        </div> : <div className="attendance-device-enroll-form">
          <label className="attendance-device-field"><span>ชื่ออุปกรณ์</span><input value={displayName} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} placeholder="เช่น iPhone เครื่องหลัก" /></label>
          {isReplacement && <label className="attendance-device-field"><span>เหตุผลที่ขอเปลี่ยนอุปกรณ์</span><textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="เช่น เปลี่ยนโทรศัพท์ใหม่ / เครื่องเดิมชำรุด" /></label>}
          <div className="attendance-device-security-note"><SmsIcon name="shield" size={18} /><span>ระบบจะสร้าง P-256 private key แบบ non-exportable บนอุปกรณ์นี้ ส่งขึ้น server เฉพาะ public key และ cryptographic proof</span></div>
          <button type="button" className="btn-primary attendance-device-enroll-action" disabled={busy || readOnly || !capability.supported || !displayName.trim() || (isReplacement && !reason.trim())} onClick={() => void enroll()}><SmsIcon name="key" size={18} />{busy ? 'กำลังสร้างและยืนยันคีย์…' : isReplacement ? 'ส่งคำขอเปลี่ยนอุปกรณ์' : 'ลงทะเบียนอุปกรณ์เครื่องแรก'}</button>
        </div>}
      </article>
    </div>

    {role === 'ADMIN' && <section className="attendance-device-admin-section">
      <div className="section-title"><div><p className="eyebrow">ADMIN REVIEW</p><h2>คำขออุปกรณ์ที่รออนุมัติ</h2><p>อนุมัติได้เฉพาะ candidate ที่พิสูจน์ possession ของ private key ผ่านแล้ว</p></div><span className="attendance-device-queue-count">{queue.length}</span></div>
      {queueError && <div className="alert alert-error" role="alert">{queueError}</div>}
      {queueLoading ? <div className="attendance-device-state">กำลังโหลดคิวอนุมัติ…</div> : queue.length ? <div className="attendance-device-review-list">{queue.map((row) => <article className="attendance-device-review-card" key={row.id}>
        <div className="attendance-device-review-card__head"><div><strong>{employeeName(row)}</strong><span>{row.employee?.department || 'ไม่ระบุหน่วยงาน'} · ผู้ยื่น {row.requestedBy?.displayName || 'บัญชีพนักงาน'}</span></div><span className={`status-badge ${row.candidateDevice?.proofVerifiedAt ? 'active' : 'pending'}`}>{row.candidateDevice?.proofVerifiedAt ? 'PROOF VERIFIED' : 'PROOF REQUIRED'}</span></div>
        <div className="attendance-device-review-meta"><div><span>ประเภท</span><b>{row.requestType === 'INITIAL' ? 'เครื่องแรก' : 'เปลี่ยนอุปกรณ์'}</b></div><div><span>อุปกรณ์</span><b>{row.candidateDevice?.displayName || '—'}</b></div><div><span>แพลตฟอร์ม</span><b>{row.candidateDevice?.platformHint || 'Web'}</b></div><div><span>ยื่นเมื่อ</span><b>{formatDate(row.createdAt)}</b></div></div>
        {row.reason && <p className="attendance-device-reason"><b>เหตุผล:</b> {row.reason}</p>}
        <footer><button type="button" className="btn-neutral" disabled={busy || readOnly} onClick={() => { setReviewTarget({ row, action: 'RETURN' }); setReviewReason(''); }}>ส่งกลับแก้ไข</button><button type="button" className="btn-danger-outline" disabled={busy || readOnly} onClick={() => { setReviewTarget({ row, action: 'REJECT' }); setReviewReason(''); }}>ไม่อนุมัติ</button><button type="button" className="btn-primary" disabled={busy || readOnly || !row.candidateDevice?.proofVerifiedAt} onClick={() => void approve(row)}><SmsIcon name="check" size={17} />อนุมัติ</button></footer>
      </article>)}</div> : <div className="attendance-device-state attendance-device-state--empty"><strong>ไม่มีคำขอรออนุมัติ</strong><span>คำขอใหม่จะแสดงที่นี่หลังพนักงานลงทะเบียนและยืนยันคีย์</span></div>}
    </section>}

    {reviewTarget && <div className="attendance-device-review-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setReviewTarget(null); }}><div className="attendance-device-review-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-device-review-title"><header><div><p>ADMIN DECISION</p><h3 id="attendance-device-review-title">{reviewTarget.action === 'RETURN' ? 'ส่งกลับให้แก้ไข' : 'ไม่อนุมัติคำขอ'}</h3><span>{employeeName(reviewTarget.row)} · {reviewTarget.row.candidateDevice?.displayName}</span></div><button type="button" className="drawer-close overlay-close" disabled={busy} onClick={() => setReviewTarget(null)} aria-label="ปิด"><SmsIcon name="close" size={20} /></button></header><label className="attendance-device-field"><span>{reviewTarget.action === 'RETURN' ? 'สิ่งที่ต้องแก้ไข' : 'เหตุผลที่ไม่อนุมัติ'}</span><textarea autoFocus value={reviewReason} maxLength={1000} onChange={(event) => setReviewReason(event.target.value)} placeholder="ระบุเหตุผลอย่างน้อย 3 ตัวอักษร" /></label><footer><button type="button" className="btn-neutral" disabled={busy} onClick={() => setReviewTarget(null)}>ยกเลิก</button><button type="button" className={reviewTarget.action === 'RETURN' ? 'btn-primary' : 'btn-danger'} disabled={busy || reviewReason.trim().length < 3} onClick={() => void submitReview()}>{busy ? 'กำลังบันทึก…' : 'ยืนยันผลพิจารณา'}</button></footer></div></div>}
  </section>;
}
