import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { formatRequestErrorMessage, RequestErrorReference, toRequestErrorState } from '../../request-error';
import { SmsIcon } from '../../components/SmsIcon';
import { auditEventLabel } from '../../components/audit/audit-utils';
import { useActionDialog } from '../../components/useActionDialog';
import { attendanceDeviceAdminOverview, revokeAttendanceDeviceCurrent } from '../attendance/attendance-client';
import {
  ATTENDANCE_DEVICE_KEY_ALGORITHM,
  attendanceDeviceCapability,
  correlateAttendanceDeviceKeyIds,
  deleteAttendanceDeviceKey,
  generateAttendanceDeviceKeyPair,
  listAttendanceDeviceKeyIds,
  pruneAttendanceDeviceKeys,
  signAttendanceDeviceChallenge,
  storeAttendanceDevicePrivateKey,
  type AttendanceDeviceKeyInspection,
  type AttendanceDeviceKeyInventory
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
  revokedReason?: string | null;
  approvedByUserId?: string | null;
  approvedBy?: { id: string; displayName?: string | null; role?: string | null };
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
  requestedBy?: { id: string; displayName?: string | null; role?: string | null };
  reviewedBy?: { id: string; displayName?: string | null; role?: string | null };
};

type SelfState = {
  employeeId: string;
  activeDevice: AttendanceDeviceEnrollment | null;
  activeRequest: AttendanceDeviceRequest | null;
};

type AttendanceDeviceAudit = {
  id: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  actor?: { id: string; displayName?: string | null };
};

type AttendanceDeviceAdminEmployee = {
  employeeId: string;
  employee?: { id: string; displayName?: string | null; firstName?: string | null; lastName?: string | null; department?: string | null };
  activeDevice: AttendanceDeviceEnrollment | null;
  activeRequest: AttendanceDeviceRequest | null;
  history: AttendanceDeviceEnrollment[];
  recentAudit: AttendanceDeviceAudit[];
};

type Props = { token: string; role: string; readOnly?: boolean };

type ReviewAction = 'RETURN' | 'REJECT';
type ReviewTarget = { row: AttendanceDeviceRequest; action: ReviewAction } | null;

function attendanceDeviceRequestCode(reason: unknown) {
  if (!reason || typeof reason !== 'object') return undefined;
  const error = reason as { code?: unknown; details?: unknown };
  if (typeof error.code === 'string') return error.code;
  if (error.details && typeof error.details === 'object' && 'code' in error.details) {
    const code = (error.details as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

const formatDate = (value?: string | null) => value
  ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value))
  : '—';

const statusLabel: Record<AttendanceDeviceRequest['status'], string> = {
  PENDING_APPROVAL: 'รอผู้ดูแลระบบอนุมัติ',
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

const enrollmentStatusLabel: Record<AttendanceDeviceEnrollment['status'], string> = {
  PENDING_APPROVAL: 'รออนุมัติ',
  ACTIVE: 'ใช้งานอยู่',
  REVOKED: 'ยกเลิกการใช้งาน',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิกแล้ว'
};

const requestTypeLabel: Record<AttendanceDeviceRequest['requestType'], string> = {
  INITIAL: 'ลงทะเบียนอุปกรณ์เครื่องแรก',
  REPLACEMENT: 'เปลี่ยนอุปกรณ์'
};

const keyInspectionLabel: Record<string, string> = {
  PRESENT: 'พบคีย์', MISSING: 'ไม่พบคีย์', INVALID: 'คีย์ไม่ถูกต้อง', UNAVAILABLE: 'อ่านคีย์ไม่ได้', UNKNOWN: 'ยังตรวจสอบไม่ได้'
};

const diagnosticBoolean = (value: boolean | null | undefined) => value === true ? 'ใช่' : value === false ? 'ไม่ใช่' : 'ยังตรวจสอบไม่ได้';
const keyInspectionText = (value?: string | null) => keyInspectionLabel[value || 'UNKNOWN'] || 'ยังตรวจสอบไม่ได้';

function employeeName(row: AttendanceDeviceRequest) {
  const employee = row.employee;
  return employee?.displayName?.trim() || [employee?.firstName, employee?.lastName].filter(Boolean).join(' ') || 'พนักงาน';
}

function adminEmployeeName(row: AttendanceDeviceAdminEmployee) {
  const employee = row.employee;
  return employee?.displayName?.trim() || [employee?.firstName, employee?.lastName].filter(Boolean).join(' ') || row.employeeId;
}

function capabilityMessage(reason?: string) {
  if (reason === 'SECURE_CONTEXT_REQUIRED') return 'การลงทะเบียนอุปกรณ์ต้องเปิดผ่าน HTTPS เพื่อใช้ Web Crypto อย่างปลอดภัย';
  if (reason === 'WEB_CRYPTO_UNAVAILABLE') return 'เบราว์เซอร์นี้ไม่รองรับ Web Crypto ที่ระบบต้องใช้';
  if (reason === 'INDEXED_DB_UNAVAILABLE') return 'เบราว์เซอร์นี้ไม่อนุญาตพื้นที่เก็บคีย์ของอุปกรณ์';
  return 'อุปกรณ์หรือเบราว์เซอร์นี้ยังไม่พร้อมสำหรับการลงทะเบียน';
}

function inspectFromInventory(inventory: AttendanceDeviceKeyInventory, enrollmentId?: string | null): AttendanceDeviceKeyInspection | null {
  if (!enrollmentId) return null;
  if (!inventory.available) return { enrollmentId, status: 'UNAVAILABLE', algorithm: null, namedCurve: null, extractable: null, usages: [], createdAt: null, errorCode: 'INDEXED_DB_UNAVAILABLE' };
  return inventory.keys.find((key) => key.enrollmentId === enrollmentId)
    || { enrollmentId, status: 'MISSING', algorithm: null, namedCurve: null, extractable: null, usages: [], createdAt: null };
}

function localKeyStatusCopy(inspection: AttendanceDeviceKeyInspection | null) {
  if (!inspection) return 'ยังไม่มีรหัสอุปกรณ์จากระบบให้ตรวจสอบ';
  if (inspection.status === 'PRESENT') return 'คีย์ลับพร้อมใช้งานบนอุปกรณ์นี้ · พร้อมยืนยันอุปกรณ์';
  if (inspection.status === 'MISSING') return 'ไม่พบคีย์ที่ตรงกับรหัสอุปกรณ์นี้ในอุปกรณ์หรือโปรไฟล์ปัจจุบัน อาจเกิดจากการล้างข้อมูลหรือเปลี่ยนอุปกรณ์/โปรไฟล์';
  if (inspection.status === 'INVALID') return 'พบข้อมูลคีย์ แต่ตรวจสอบไม่ผ่าน จึงยืนยันอุปกรณ์ไม่ได้';
  return 'อ่านพื้นที่จัดเก็บข้อมูลของอุปกรณ์ไม่ได้ จึงยังตรวจสอบคีย์ได้ไม่ครบ';
}

function localKeyReadinessState(inspection: AttendanceDeviceKeyInspection | null, capabilitySupported: boolean) {
  if (!inspection) return 'UNKNOWN';
  if (inspection.status === 'PRESENT') return capabilitySupported ? 'READY_LOCAL_KEY' : 'RUNTIME_UNAVAILABLE';
  if (inspection.status === 'MISSING') return 'MISSING_LOCAL_KEY';
  if (inspection.status === 'INVALID') return 'INVALID_LOCAL_KEY';
  return 'LOCAL_KEY_UNAVAILABLE';
}

export function AttendanceDevicePage({ token, role, readOnly = false }: Props) {
  const actionDialog = useActionDialog();
  const capability = useMemo(() => attendanceDeviceCapability(), []);
  const [selfState, setSelfState] = useState<SelfState | null>(null);
  const [selfLoading, setSelfLoading] = useState(true);
  const [selfError, setSelfError] = useState<string>();
  const [selfErrorRequestId, setSelfErrorRequestId] = useState<string>();
  const [employeeLinkRequired, setEmployeeLinkRequired] = useState(false);
  const [queue, setQueue] = useState<AttendanceDeviceRequest[]>([]);
  const [queueLoading, setQueueLoading] = useState(role === 'ADMIN');
  const [queueError, setQueueError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [displayName, setDisplayName] = useState('โทรศัพท์ลงเวลาของฉัน');
  const [reason, setReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [keyInventory, setKeyInventory] = useState<AttendanceDeviceKeyInventory | null>(null);
  const [activeKeyInspection, setActiveKeyInspection] = useState<AttendanceDeviceKeyInspection | null>(null);
  const [candidateKeyInspection, setCandidateKeyInspection] = useState<AttendanceDeviceKeyInspection | null>(null);
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [adminOverview, setAdminOverview] = useState<AttendanceDeviceAdminEmployee[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(role === 'ADMIN');
  const [revokeTarget, setRevokeTarget] = useState<AttendanceDeviceAdminEmployee | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const loadSelf = async () => {
    setSelfLoading(true); setSelfError(undefined); setSelfErrorRequestId(undefined); setEmployeeLinkRequired(false);
    try {
      const response = await api.attendanceDeviceState(token);
      const next = response.data as SelfState;
      setSelfState(next);
      setEmployeeLinkRequired(false);
      let inventory = await listAttendanceDeviceKeyIds(next.employeeId);
      let activeInspection = inspectFromInventory(inventory, next.activeDevice?.id);
      let candidateInspection = inspectFromInventory(inventory, next.activeRequest?.candidateDeviceEnrollmentId);
      const hasPotentialIdMismatch = Boolean(next.activeDevice?.id && activeInspection?.status === 'MISSING' && inventory.available && inventory.keys.length > 0);
      if (capability.supported && !hasPotentialIdMismatch) {
        const allowedIds = [next.activeDevice?.id, next.activeRequest?.candidateDeviceEnrollmentId].filter(Boolean) as string[];
        await pruneAttendanceDeviceKeys(next.employeeId, allowedIds).catch(() => undefined);
        inventory = await listAttendanceDeviceKeyIds(next.employeeId);
        activeInspection = inspectFromInventory(inventory, next.activeDevice?.id);
        candidateInspection = inspectFromInventory(inventory, next.activeRequest?.candidateDeviceEnrollmentId);
      }
      setKeyInventory(inventory);
      setActiveKeyInspection(activeInspection);
      setCandidateKeyInspection(candidateInspection);
    } catch (error) {
      setSelfState(null);
      setKeyInventory(null);
      setActiveKeyInspection(null);
      setCandidateKeyInspection(null);
      const requestError = toRequestErrorState(error, 'ไม่สามารถอ่านสถานะอุปกรณ์ลงเวลาได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ');
      const linkedAccountRequired = ['ATTENDANCE_DEVICE_EMPLOYEE_LINK_REQUIRED', 'ATTENDANCE_EMPLOYEE_LINK_REQUIRED']
        .includes(attendanceDeviceRequestCode(error) || '');
      setEmployeeLinkRequired(linkedAccountRequired);
      setSelfError(linkedAccountRequired
        ? 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน กรุณาติดต่อผู้ดูแลระบบ'
        : requestError.message);
      setSelfErrorRequestId(requestError.requestId);
    } finally { setSelfLoading(false); }
  };

  const loadQueue = async () => {
    if (role !== 'ADMIN') return;
    setQueueLoading(true); setQueueError(undefined);
    try { setQueue((await api.attendanceDeviceRequests(token)).data || []); }
    catch (error) { setQueueError(formatRequestErrorMessage(error, 'ไม่สามารถอ่านคิวอนุมัติอุปกรณ์ได้')); }
    finally { setQueueLoading(false); }
  };

  const loadAdminOverview = async () => {
    if (role !== 'ADMIN') return;
    setOverviewLoading(true);
    try { setAdminOverview((await attendanceDeviceAdminOverview(token)) || []); }
    catch (error) { setQueueError(formatRequestErrorMessage(error, 'ไม่สามารถอ่านประวัติอุปกรณ์ลงเวลาได้')); }
    finally { setOverviewLoading(false); }
  };

  const refresh = async () => { await Promise.allSettled([loadSelf(), loadQueue(), loadAdminOverview()]); };

  useEffect(() => { void refresh(); }, [token, role]);

  const proveRequest = async (request: AttendanceDeviceRequest) => {
    const candidateId = request.candidateDeviceEnrollmentId;
    const options = (await api.attendanceDeviceProofOptions(token, request.id)).data;
    const signatureBase64 = await signAttendanceDeviceChallenge(candidateId, options.challenge);
    await api.verifyAttendanceDeviceProof(token, request.id, { challengeId: options.challengeId, challenge: options.challenge, signatureBase64 });
  };

  const enroll = async () => {
    if (readOnly || employeeLinkRequired) return;
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
      setSelfError(formatRequestErrorMessage(error, 'ลงทะเบียนอุปกรณ์ไม่สำเร็จ'));
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
    } catch (error) { setSelfError(formatRequestErrorMessage(error, 'ยืนยันคีย์ของอุปกรณ์ไม่สำเร็จ')); }
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
    } catch (error) { setSelfError(formatRequestErrorMessage(error, 'ยกเลิกคำขอไม่สำเร็จ')); }
    finally { setBusy(false); }
  };

    const submitRevoke = async () => {
    if (!revokeTarget?.activeDevice || readOnly || role !== 'ADMIN') return;
    const text = revokeReason.trim();
    if (text.length < 3) { setQueueError('กรุณาระบุเหตุผลการยกเลิกอุปกรณ์อย่างน้อย 3 ตัวอักษร'); return; }
    setBusy(true); setQueueError(undefined); setMessage(undefined);
    try {
      await revokeAttendanceDeviceCurrent(token, revokeTarget.employeeId, revokeTarget.activeDevice.id, text);
      setMessage(`ยกเลิกอุปกรณ์ปัจจุบันของ ${adminEmployeeName(revokeTarget)} แล้ว โดยไม่มีการเปิดใช้อุปกรณ์อื่นอัตโนมัติ`);
      setRevokeTarget(null); setRevokeReason('');
      await refresh();
    } catch (error) { setQueueError(formatRequestErrorMessage(error, 'ยกเลิกอุปกรณ์ปัจจุบันไม่สำเร็จ')); }
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
    } catch (error) { setSelfError(formatRequestErrorMessage(error, 'ส่งคำขออีกครั้งไม่สำเร็จ')); }
    finally { setBusy(false); }
  };

  const approve = async (row: AttendanceDeviceRequest) => {
    if (readOnly || role !== 'ADMIN') return;
    if (!row.candidateDevice?.proofVerifiedAt) { setQueueError('ยังอนุมัติไม่ได้: อุปกรณ์นี้ยังยืนยันรหัสประจำเครื่องไม่สำเร็จ'); return; }
    const confirmed = await actionDialog.confirm({
      title: 'อนุมัติอุปกรณ์ลงเวลา',
      message: 'อุปกรณ์นี้ผ่านการยืนยันแล้ว การอนุมัติจะเปิดใช้งานเป็นอุปกรณ์ลงเวลาตามกฎปัจจุบัน',
      context: `${employeeName(row)} · ${row.candidateDevice.displayName}`,
      confirmLabel: 'ยืนยันอนุมัติอุปกรณ์',
      tone: 'primary'
    });
    if (!confirmed) return;
    setBusy(true); setQueueError(undefined); setMessage(undefined);
    try { await api.approveAttendanceDeviceRequest(token, row.id); setMessage('อนุมัติอุปกรณ์ลงเวลาแล้ว'); await refresh(); }
    catch (error) { setQueueError(formatRequestErrorMessage(error, 'อนุมัติอุปกรณ์ไม่สำเร็จ')); }
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
    } catch (error) { setQueueError(formatRequestErrorMessage(error, 'บันทึกผลพิจารณาไม่สำเร็จ')); }
    finally { setBusy(false); }
  };

  const request = selfState?.activeRequest;
  const activeDevice = selfState?.activeDevice;
  const isReplacement = Boolean(activeDevice);
  const proofReady = Boolean(request?.candidateDevice?.proofVerifiedAt);
  const activeIdChain = correlateAttendanceDeviceKeyIds({
    activeDeviceId: activeDevice?.id,
    candidateDeviceId: request?.candidateDeviceEnrollmentId,
    storedEnrollmentIds: keyInventory?.enrollmentIds || []
  });
  const activeLocalKeyPresent = activeKeyInspection?.status === 'PRESENT' && activeIdChain.activeKeyIdMatch === true;
  const activeLocalKeyReady = activeLocalKeyPresent && capability.supported;
  const candidateLocalKeyPresent = candidateKeyInspection?.status === 'PRESENT';
  const activeLocalKeyCopy = activeLocalKeyPresent && !capability.supported
    ? `พบข้อมูลคีย์ในอุปกรณ์นี้ แต่เบราว์เซอร์ยังยืนยันอุปกรณ์ไม่ได้: ${capabilityMessage(capability.reason)}`
    : `${localKeyStatusCopy(activeKeyInspection)}${activeKeyInspection?.status === 'MISSING' ? ' ระบบจะหยุดการลงเวลาก่อนยืนยันอุปกรณ์ โปรดตรวจสอบรหัสอุปกรณ์ก่อนขอเปลี่ยนหรือลงทะเบียนใหม่' : ''}`;
  const candidateLocalKeyCopy = candidateLocalKeyPresent && !capability.supported
    ? `พบข้อมูลคีย์ในอุปกรณ์นี้ แต่เบราว์เซอร์ยังยืนยันอุปกรณ์ไม่ได้: ${capabilityMessage(capability.reason)}`
    : localKeyStatusCopy(candidateKeyInspection);

  return <><section className="view-pane attendance-device-page nexus-device-registry" aria-label="จัดการอุปกรณ์ลงเวลา">
    <div className="nexus-page-breadcrumb">อุปกรณ์ลงเวลา</div>
    <div className="page-heading attendance-device-heading">
      <div><p className="eyebrow">อุปกรณ์ลงเวลา</p><h1>อุปกรณ์ลงเวลา</h1><p>พนักงานหนึ่งคนใช้อุปกรณ์หลักได้หนึ่งเครื่อง การลงทะเบียนครั้งแรกและการเปลี่ยนเครื่องต้องได้รับอนุมัติจากผู้ดูแลระบบ</p></div>
      <div className="heading-actions"><button type="button" className="btn-neutral small-action" disabled={busy} onClick={() => void refresh()}><SmsIcon name="refresh" size={17} />รีเฟรช</button></div>
    </div>

    {readOnly && <div className="settings-notice">กำลังอยู่ใน View As — หน้านี้เป็นแบบอ่านอย่างเดียวและไม่อนุญาตให้ลงทะเบียนหรืออนุมัติอุปกรณ์</div>}
    {!capability.supported && <div className="alert alert-error">{capabilityMessage(capability.reason)}</div>}
    {message && <div className="settings-notice success" role="status">{message}</div>}

    <div className="attendance-device-grid">
      <article className="attendance-device-card attendance-device-card--primary">
        <header><span className="attendance-device-card__icon"><SmsIcon name="key" size={21} /></span><div><h2>อุปกรณ์หลักของฉัน</h2><p>คีย์สำหรับยืนยันอุปกรณ์จัดเก็บไว้ในเบราว์เซอร์นี้และไม่สามารถส่งออกได้</p></div></header>
        {selfLoading ? <div className="attendance-device-state">กำลังอ่านสถานะอุปกรณ์…</div>
          : activeDevice ? <div className="attendance-device-current" data-testid="attendance-active-device" data-local-key-state={localKeyReadinessState(activeKeyInspection, capability.supported)}>
            <div className="attendance-device-current__hero"><span className={`device-orb ${activeLocalKeyReady ? '' : 'is-warning'}`}><SmsIcon name={activeLocalKeyReady ? 'check' : 'key'} size={22} /></span><div><strong>{activeDevice.displayName}</strong><span>อุปกรณ์หลักเปิดใช้งานสำหรับลงเวลาและตรวจเวร</span></div></div>
            <div className={`device-proof-state ${activeLocalKeyReady ? 'is-ready' : 'is-warning'}`} role={activeLocalKeyReady ? 'status' : 'alert'}>
              <SmsIcon name={activeLocalKeyReady ? 'check' : 'key'} size={18} />
              <div><strong>{activeLocalKeyReady ? 'คีย์ลับพร้อมใช้งานบนอุปกรณ์นี้' : 'ระบบระบุว่าอุปกรณ์ใช้งานอยู่ แต่ยังไม่พบคีย์ในอุปกรณ์นี้'}</strong><span>{activeLocalKeyCopy}</span></div>
            </div>
            <dl><div><dt>เปิดใช้งาน</dt><dd>{formatDate(activeDevice.activatedAt)}</dd></div><div><dt>ผู้อนุมัติ</dt><dd>{activeDevice.approvedBy?.displayName || 'ไม่พบชื่อผู้อนุมัติ'}</dd></div><div><dt>แพลตฟอร์ม</dt><dd>{activeDevice.platformHint || 'Web'}</dd></div><div><dt>Key</dt><dd>{activeDevice.keyAlgorithm}</dd></div></dl>
          </div> : !selfError ? <div className="attendance-device-state attendance-device-state--empty"><strong>ยังไม่มีอุปกรณ์หลัก</strong><span>ลงทะเบียนจากโทรศัพท์หรืออุปกรณ์ที่ต้องการใช้ลงเวลา แล้วรอ Admin อนุมัติ</span></div> : null}
        {activeDevice && <details className="attendance-device-diagnostics" data-testid="attendance-device-id-diagnostics">
          <summary>รายละเอียดการตรวจสถานะคีย์ในเบราว์เซอร์นี้</summary>
          <dl>
            <div><dt>อุปกรณ์หลักในระบบ</dt><dd>{activeIdChain.activeDeviceId || '—'}</dd></div>
            <div><dt>มีคีย์ส่วนตัวในอุปกรณ์นี้</dt><dd>{activeKeyInspection?.status === 'PRESENT' && activeIdChain.activeKeyIdMatch === true ? 'มี' : activeKeyInspection?.status === 'MISSING' ? 'ไม่มี' : 'ยังตรวจสอบไม่ได้'} · {keyInspectionText(activeKeyInspection?.status)}</dd></div>
            <div><dt>ผลการเทียบรหัสอุปกรณ์</dt><dd>{activeIdChain.activeKeyIdMatch === true ? 'ตรงกัน' : activeIdChain.activeKeyIdMatch === false ? 'ไม่ตรงกัน' : 'ยังตรวจสอบไม่ได้'}</dd></div>
            <div><dt>รหัสอุปกรณ์ในการตรวจสอบ</dt><dd>ยังไม่มีข้อมูลการตรวจสอบในหน้านี้</dd></div>
            <div><dt>ผลการตรวจสอบรหัสอุปกรณ์</dt><dd>ยังไม่ได้ตรวจในหน้านี้</dd></div>
            <div><dt>รหัสอุปกรณ์ที่รอพิจารณา</dt><dd>{activeIdChain.candidateDeviceId || '—'}</dd></div>
            <div><dt>สถานะคีย์อุปกรณ์ที่รอพิจารณา</dt><dd>{candidateKeyInspection ? keyInspectionText(candidateKeyInspection.status) : 'ไม่พบอุปกรณ์ที่รอพิจารณา'}{candidateLocalKeyPresent ? ' · รหัสตรงกัน' : ''}</dd></div>
            <div><dt>รหัสอุปกรณ์ที่เก็บในเบราว์เซอร์</dt><dd>{keyInventory?.available ? activeIdChain.storedEnrollmentIds.join(', ') || 'ไม่มีรหัสอุปกรณ์ที่อ่านได้' : 'อ่านพื้นที่จัดเก็บไม่ได้'}</dd></div>
            <div><dt>จำนวนข้อมูลคีย์ที่อ่านไม่ได้</dt><dd>{keyInventory?.available ? keyInventory.malformedRecordCount : 'ยังตรวจสอบไม่ได้'}</dd></div>
            <div><dt>รายละเอียดคีย์ในอุปกรณ์</dt><dd>{activeKeyInspection?.algorithm || '—'} / {activeKeyInspection?.namedCurve || '—'} · ส่งออกได้={diagnosticBoolean(activeKeyInspection?.extractable)} · ใช้เพื่อ={activeKeyInspection?.usages.map((usage) => usage === 'sign' ? 'ลงนาม' : usage === 'verify' ? 'ตรวจลายเซ็น' : usage).join(', ') || '—'}</dd></div>
            <div><dt>พื้นที่จัดเก็บในเบราว์เซอร์</dt><dd>การเชื่อมต่อปลอดภัย={diagnosticBoolean(window.isSecureContext)} · Web Crypto={diagnosticBoolean(Boolean(globalThis.crypto?.subtle))} · IndexedDB={keyInventory?.available ? 'อ่านได้' : 'ใช้ไม่ได้'}</dd></div>
          </dl>
        </details>}
        {selfError && <div className="alert alert-error" role="alert"><span>{selfError}</span>{selfErrorRequestId && <details className="attendance-device-error-reference"><summary>รายละเอียดสำหรับผู้ดูแล</summary><RequestErrorReference requestId={selfErrorRequestId} /></details>}</div>}
      </article>

      <article className="attendance-device-card">
        <header><span className="attendance-device-card__icon"><SmsIcon name="shield" size={21} /></span><div><h2>{employeeLinkRequired ? 'ลงทะเบียนอุปกรณ์ไม่ได้' : request ? 'คำขอที่กำลังดำเนินการ' : isReplacement ? 'ขอเปลี่ยนอุปกรณ์' : 'ลงทะเบียนอุปกรณ์เครื่องแรก'}</h2><p>{employeeLinkRequired ? 'ต้องผูกบัญชีกับข้อมูลพนักงานก่อน จึงจะลงทะเบียนอุปกรณ์ได้' : 'บัญชีหรือรหัสผ่านยืนยันตัวตนเพียงอย่างเดียวไม่ยืนยันว่าอุปกรณ์นี้เป็นเครื่องที่ใช้ลงเวลา ต้องรอผู้ดูแลระบบอนุมัติ'}</p></div></header>
        {request ? <div className="attendance-device-request">
          <div className="attendance-device-request__top"><div><strong>{request.candidateDevice?.displayName || 'อุปกรณ์ที่ขอลงทะเบียน'}</strong><span>{request.requestType === 'INITIAL' ? 'เครื่องแรก' : 'เปลี่ยนอุปกรณ์'}</span></div><span className={`status-badge ${statusClass[request.status]}`}>{statusLabel[request.status]}</span></div>
          <div className={`device-proof-state ${proofReady ? 'is-ready' : 'is-warning'}`} data-testid="attendance-candidate-key-state" data-local-key-state={candidateKeyInspection?.status || 'UNKNOWN'}><SmsIcon name={proofReady ? 'check' : 'key'} size={18} /><div><strong>{proofReady ? 'ยืนยันอุปกรณ์ผ่านแล้ว' : 'สถานะการยืนยันอุปกรณ์'}</strong><span>{proofReady ? `ยืนยันเมื่อ ${formatDate(request.candidateDevice?.proofVerifiedAt)}` : candidateLocalKeyCopy}</span></div></div>
          {request.reason && <p className="attendance-device-reason"><b>เหตุผล:</b> {request.reason}</p>}
          {request.reviewerComment && <div className="attendance-device-review-note"><b>ความเห็นผู้ตรวจ:</b><span>{request.reviewerComment}</span></div>}
          {request.status === 'RETURNED_FOR_CORRECTION' && <label className="attendance-device-field"><span>เหตุผล/คำชี้แจงสำหรับส่งใหม่</span><textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder={request.reason || 'ระบุคำชี้แจงเพิ่มเติม'} /></label>}
          {!proofReady && candidateKeyInspection?.status !== 'MISSING' && candidateKeyInspection?.status !== 'INVALID' && <button type="button" className="btn-primary" disabled={busy || readOnly || !capability.supported} onClick={() => void retryProof()}><SmsIcon name="key" size={17} />{busy ? 'กำลังยืนยัน…' : 'ยืนยันอุปกรณ์อีกครั้ง'}</button>}
          {request.status === 'RETURNED_FOR_CORRECTION' && <button type="button" className="btn-primary" disabled={busy || readOnly} onClick={() => void resubmit()}><SmsIcon name="refresh" size={17} />ส่งให้ Admin พิจารณาอีกครั้ง</button>}
          <div className="attendance-device-cancel"><label className="attendance-device-field"><span>เหตุผลที่ยกเลิกคำขอ</span><input value={cancelReason} maxLength={1000} onChange={(event) => setCancelReason(event.target.value)} placeholder="เช่น เลือกอุปกรณ์ผิด / ต้องการลงทะเบียนใหม่" /></label><button type="button" className="btn-danger-outline" disabled={busy || readOnly || !cancelReason.trim()} onClick={() => void cancelRequest()}>ยกเลิกคำขอนี้</button></div>
        </div> : employeeLinkRequired ? <div className="attendance-device-state attendance-device-state--empty"><strong>กรุณาติดต่อผู้ดูแลระบบ</strong><span>ผู้ดูแลจะผูกบัญชีนี้กับข้อมูลพนักงานก่อนเปิดให้ลงทะเบียนอุปกรณ์</span></div> : <div className="attendance-device-enroll-form">
          <label className="attendance-device-field"><span>ชื่ออุปกรณ์</span><input value={displayName} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} placeholder="เช่น iPhone เครื่องหลัก" /></label>
          {isReplacement && <label className="attendance-device-field"><span>เหตุผลที่ขอเปลี่ยนอุปกรณ์</span><textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="เช่น เปลี่ยนโทรศัพท์ใหม่ / เครื่องเดิมชำรุด" /></label>}
          <div className="attendance-device-security-note"><SmsIcon name="shield" size={18} /><span>ระบบจะผูกบัญชีของคุณกับอุปกรณ์นี้อย่างปลอดภัย และต้องรอผู้ดูแลระบบอนุมัติ</span></div>
          <button type="button" className="btn-primary attendance-device-enroll-action" disabled={busy || readOnly || !capability.supported || !displayName.trim() || (isReplacement && !reason.trim())} onClick={() => void enroll()}><SmsIcon name="key" size={18} />{busy ? 'กำลังสร้างและยืนยันคีย์…' : isReplacement ? 'ส่งคำขอเปลี่ยนอุปกรณ์' : 'ลงทะเบียนอุปกรณ์เครื่องแรก'}</button>
        </div>}
      </article>
    </div>

    {role === 'ADMIN' && <section className="attendance-device-admin-section">
      <div className="section-title"><div><p className="eyebrow">ADMIN REVIEW</p><h2>คำขออุปกรณ์ที่รออนุมัติ</h2><p>อนุมัติได้เมื่ออุปกรณ์ผ่านการยืนยันแล้วเท่านั้น</p></div>{!queueLoading && !queueError && <span className="attendance-device-queue-count">{queue.length}</span>}</div>
      {queueError && <div className="alert alert-error" role="alert">{queueError}</div>}
      {queueLoading ? <div className="attendance-device-state">กำลังโหลดคิวอนุมัติ…</div> : queue.length ? <div className="attendance-device-review-list">{queue.map((row) => <article className="attendance-device-review-card" key={row.id}>
        <div className="attendance-device-review-card__head"><div><strong>{employeeName(row)}</strong><span>{row.employee?.department || 'ไม่ระบุหน่วยงาน'} · ผู้ยื่น {row.requestedBy?.displayName || 'บัญชีพนักงาน'}</span></div><span className={`status-badge ${row.candidateDevice?.proofVerifiedAt ? 'active' : 'pending'}`}>{row.candidateDevice?.proofVerifiedAt ? 'ยืนยันอุปกรณ์แล้ว' : 'รอยืนยันอุปกรณ์'}</span></div>
        <div className="attendance-device-review-meta"><div><span>ประเภท</span><b>{row.requestType === 'INITIAL' ? 'เครื่องแรก' : 'เปลี่ยนอุปกรณ์'}</b></div><div><span>อุปกรณ์</span><b>{row.candidateDevice?.displayName || '—'}</b></div><div><span>แพลตฟอร์ม</span><b>{row.candidateDevice?.platformHint || 'Web'}</b></div><div><span>ยื่นเมื่อ</span><b>{formatDate(row.createdAt)}</b></div></div>
        {row.reason && <p className="attendance-device-reason"><b>เหตุผล:</b> {row.reason}</p>}
        <footer><button type="button" className="btn-neutral" disabled={busy || readOnly} onClick={() => { setReviewTarget({ row, action: 'RETURN' }); setReviewReason(''); }}>ส่งกลับแก้ไข</button><button type="button" className="btn-danger-outline" disabled={busy || readOnly} onClick={() => { setReviewTarget({ row, action: 'REJECT' }); setReviewReason(''); }}>ไม่อนุมัติ</button><button type="button" className="btn-primary" disabled={busy || readOnly || !row.candidateDevice?.proofVerifiedAt} onClick={() => void approve(row)}><SmsIcon name="check" size={17} />อนุมัติ</button></footer>
      </article>)}</div> : <div className="attendance-device-state attendance-device-state--empty"><strong>ไม่มีคำขอรออนุมัติ</strong><span>คำขอใหม่จะแสดงที่นี่หลังพนักงานลงทะเบียนและยืนยันคีย์</span></div>}
    </section>}

    {role === 'ADMIN' && <section className="attendance-device-admin-section">
      <div className="section-title"><div><p className="eyebrow">จัดการอุปกรณ์</p><h2>จัดการอุปกรณ์ลงเวลาพนักงาน</h2><p>ตรวจสอบอุปกรณ์ที่ลงทะเบียน ประวัติการอนุมัติและการยกเลิก โดยใช้ชื่อเครื่องและแพลตฟอร์มเป็นข้อมูลประกอบเท่านั้น</p></div>{!overviewLoading && !queueError && <span className="attendance-device-queue-count">{adminOverview.length}</span>}</div>
      {overviewLoading ? <div className="attendance-device-state">กำลังโหลดประวัติอุปกรณ์…</div> : adminOverview.length ? <div className="attendance-device-review-list">{adminOverview.map((row) => <article className="attendance-device-review-card" key={row.employeeId}>
        <div className="attendance-device-review-card__head"><div><strong>{adminEmployeeName(row)}</strong><span>{row.employee?.department || 'ไม่ระบุหน่วยงาน'}</span></div><span className={`status-badge ${row.activeDevice ? 'active' : 'muted'}`}>{row.activeDevice ? 'มีอุปกรณ์ใช้งานอยู่' : 'ไม่มีอุปกรณ์ใช้งานอยู่'}</span></div>
        {row.activeDevice ? <div className="attendance-device-review-meta"><div><span>อุปกรณ์ปัจจุบัน</span><b>{row.activeDevice.displayName}</b></div><div><span>การยืนยันอุปกรณ์</span><b>{row.activeDevice.proofVerifiedAt ? `ผ่าน · ${formatDate(row.activeDevice.proofVerifiedAt)}` : 'ไม่พบหลักฐาน'}</b></div><div><span>เปิดใช้งานเมื่อ</span><b>{formatDate(row.activeDevice.activatedAt)}</b></div><div><span>รหัสอ้างอิงอุปกรณ์</span><b>{row.activeDevice.credentialFingerprint?.slice(0, 12) || '—'}…</b></div></div> : <div className="attendance-device-state attendance-device-state--empty"><strong>ไม่มีอุปกรณ์ใช้งานอยู่</strong><span>พนักงานต้องลงทะเบียนและผ่านการยืนยันอุปกรณ์ก่อนส่งให้ผู้ดูแลระบบอนุมัติอุปกรณ์ใหม่</span></div>}
        {row.activeRequest && <p className="attendance-device-reason"><b>คำขอที่กำลังดำเนินการ:</b> {requestTypeLabel[row.activeRequest.requestType]} · {statusLabel[row.activeRequest.status]}{row.activeRequest.reason ? ` · ${row.activeRequest.reason}` : ''}</p>}
        <div className="attendance-device-history-block"><strong>ประวัติอุปกรณ์ ({row.history.length})</strong>{row.history.map((device) => <div className="attendance-device-review-meta" key={device.id}><div><span>สถานะ</span><b>{enrollmentStatusLabel[device.status]}</b></div><div><span>อุปกรณ์</span><b>{device.displayName}</b></div><div><span>การยืนยันอุปกรณ์ / เปิดใช้งาน</span><b>{device.proofVerifiedAt ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยัน'} · {formatDate(device.activatedAt)}</b></div><div><span>ผู้อนุมัติ</span><b>{device.approvedBy?.displayName || (device.status === 'ACTIVE' ? 'ไม่พบชื่อผู้อนุมัติ' : '—')}</b></div><div><span>ยกเลิกเมื่อ</span><b>{formatDate(device.revokedAt)}{device.revokedReason ? ` · ${device.revokedReason}` : ''}</b></div></div>)}</div>
        {row.recentAudit.length > 0 && <div className="attendance-device-history-block"><strong>ประวัติเหตุการณ์</strong>{row.recentAudit.slice(0, 5).map((audit) => <p className="attendance-device-reason" key={audit.id}><b>{auditEventLabel(audit.metadata?.event || audit.action)}</b> · {formatDate(audit.createdAt)} · {audit.actor?.displayName || 'ระบบ'}{typeof audit.metadata?.reason === 'string' ? ` · ${audit.metadata.reason}` : ''}</p>)}</div>}
        {row.activeDevice && <footer><button type="button" className="btn-danger-outline" disabled={busy || readOnly} onClick={() => { setRevokeTarget(row); setRevokeReason(''); }}>ยกเลิกอุปกรณ์ปัจจุบัน</button></footer>}
      </article>)}</div> : <div className="attendance-device-state attendance-device-state--empty"><strong>ยังไม่มีประวัติอุปกรณ์</strong><span>เมื่อมีการลงทะเบียนอุปกรณ์ รายการจะปรากฏที่นี่</span></div>}
    </section>}

    {revokeTarget?.activeDevice && <div className="attendance-device-review-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setRevokeTarget(null); }}><div className="attendance-device-review-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-device-revoke-title"><header><div><p>การดูแลอุปกรณ์โดยผู้ดูแลระบบ</p><h3 id="attendance-device-revoke-title">ยกเลิกอุปกรณ์ปัจจุบัน</h3><span>{adminEmployeeName(revokeTarget)} · {revokeTarget.activeDevice.displayName}</span></div><button type="button" className="drawer-close overlay-close" disabled={busy} onClick={() => setRevokeTarget(null)} aria-label="ปิด"><SmsIcon name="close" size={20} /></button></header><div className="settings-notice">การยกเลิกมีผลทันที ระบบจะไม่เปิดใช้อุปกรณ์อื่นอัตโนมัติ และคำขอเปลี่ยนอุปกรณ์ที่ค้างอยู่จะถูกยกเลิกเพื่อป้องกันคำขอเก่าค้างอยู่</div><label className="attendance-device-field"><span>เหตุผลการยกเลิก (บังคับ)</span><textarea autoFocus value={revokeReason} maxLength={1000} onChange={(event) => setRevokeReason(event.target.value)} placeholder="เช่น อุปกรณ์สูญหาย / เลิกใช้งาน / เปลี่ยนเครื่อง" /></label><footer><button type="button" className="btn-neutral" disabled={busy} onClick={() => setRevokeTarget(null)}>ยกเลิก</button><button type="button" className="btn-danger" disabled={busy || revokeReason.trim().length < 3} onClick={() => void submitRevoke()}>{busy ? 'กำลังบันทึก…' : 'ยืนยันยกเลิกอุปกรณ์'}</button></footer></div></div>}

    {reviewTarget && <div className="attendance-device-review-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setReviewTarget(null); }}><div className="attendance-device-review-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-device-review-title"><header><div><p>การพิจารณาคำขอของผู้ดูแลระบบ</p><h3 id="attendance-device-review-title">{reviewTarget.action === 'RETURN' ? 'ส่งกลับให้แก้ไข' : 'ไม่อนุมัติคำขอ'}</h3><span>{employeeName(reviewTarget.row)} · {reviewTarget.row.candidateDevice?.displayName}</span></div><button type="button" className="drawer-close overlay-close" disabled={busy} onClick={() => setReviewTarget(null)} aria-label="ปิด"><SmsIcon name="close" size={20} /></button></header><label className="attendance-device-field"><span>{reviewTarget.action === 'RETURN' ? 'สิ่งที่ต้องแก้ไข' : 'เหตุผลที่ไม่อนุมัติ'}</span><textarea autoFocus value={reviewReason} maxLength={1000} onChange={(event) => setReviewReason(event.target.value)} placeholder="ระบุเหตุผลอย่างน้อย 3 ตัวอักษร" /></label><footer><button type="button" className="btn-neutral" disabled={busy} onClick={() => setReviewTarget(null)}>ยกเลิก</button><button type="button" className={reviewTarget.action === 'RETURN' ? 'btn-primary' : 'btn-danger'} disabled={busy || reviewReason.trim().length < 3} onClick={() => void submitReview()}>{busy ? 'กำลังบันทึก…' : 'ยืนยันผลพิจารณา'}</button></footer></div></div>}
  </section>{actionDialog.dialog}</>;
}
