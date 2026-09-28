import { useState } from 'react';
import { formatRequestErrorMessage } from '../../request-error';

export type G06AttendanceAuthorityResult = {
  idempotent: boolean;
  workDate: string;
  assignment: { id: string; source: string; locked: boolean };
  shift: { code: string; name: string; startTime: string; endTime: string };
  site: { id: string; code: string; name: string; geofenceRadiusMeters: number };
  approval: { status: string; revision: number; month: string };
  provisioningPath: 'GOVERNED_PREVIEW_ONLY';
  previewDatabaseTarget: 'verified';
};

export type G06UatProvisionResult = {
  created: boolean;
  duplicate: boolean;
  provisioningPath: 'GOVERNED_PREVIEW_ONLY';
  otpPublicFlowChanged: false;
  previewDatabaseTarget: 'verified';
  employee: {
    id: string;
    employeeCode: string;
    displayName: string;
    department: string | null;
    jobTitle: string | null;
    isActive: boolean;
    accountLinked: boolean;
  } | null;
  account: {
    id: string;
    email: string;
    displayName: string;
    role: string;
    employeeId: string;
    isActive: boolean;
    accountStatus: string;
    passwordResetRequired: boolean;
  } | null;
  temporaryPassword: string | null;
};

type Props = {
  onProvision(): Promise<G06UatProvisionResult>;
  onPrepareAttendance(location: { latitude: number; longitude: number; accuracyMeters: number; capturedAt: string }): Promise<G06AttendanceAuthorityResult>;
};

export function G06UatProvisioningPanel({ onProvision, onPrepareAttendance }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<G06UatProvisionResult>();
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [attendanceResult, setAttendanceResult] = useState<G06AttendanceAuthorityResult>();

  const provision = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setResult(await onProvision());
    } catch (reason) {
      setError(formatRequestErrorMessage(reason, 'ไม่สามารถสร้าง Preview UAT fixture ได้'));
    } finally {
      setBusy(false);
    }
  };

  const prepareAttendance = async () => {
    if (attendanceBusy) return;
    if (!navigator.geolocation) {
      setError('อุปกรณ์นี้ไม่รองรับ GPS สำหรับเตรียม Attendance UAT');
      return;
    }
    setAttendanceBusy(true);
    setError(undefined);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }));
      const prepared = await onPrepareAttendance({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        capturedAt: new Date(position.timestamp).toISOString()
      });
      setAttendanceResult(prepared);
    } catch (reason) {
      setError(formatRequestErrorMessage(reason, 'ไม่สามารถเตรียม Attendance UAT จาก GPS ปัจจุบันได้'));
    } finally {
      setAttendanceBusy(false);
    }
  };
  return <section className="g06-uat-provisioning-panel data-surface-card" aria-label="G06 Preview UAT provisioning">
    <div className="account-section-heading"><span aria-hidden="true">🧪</span><div><h2>G06 Preview UAT Fixture</h2><p>กลไกเฉพาะสำหรับสร้างบัญชีทดสอบ Preview หนึ่งชุดเท่านั้น ไม่กระทบ public registration หรือ Production</p></div></div>
    <dl className="account-detail-grid">
      <div><dt>Employee code</dt><dd>UAT-G06-20260911-01</dd></div>
      <div><dt>Purpose</dt><dd>G06 Face Diagnostic</dd></div>
      <div><dt>Role</dt><dd>VIEWER</dd></div>
      <div><dt>Environment</dt><dd>Preview only</dd></div>
    </dl>
    <label className="access-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} />ยืนยันว่าจะสร้างเฉพาะ UAT fixture นี้ใน Preview และไม่เริ่ม Face/Attendance</label>
    <button type="button" className="btn-warning" disabled={!confirmed || busy} onClick={provision}>{busy ? 'กำลังสร้าง…' : 'สร้าง G06 Preview UAT fixture'}</button>
    {error && <p className="access-dialog-error" role="alert">{error}</p>}
    {result && <div className="g06-uat-provisioning-result" role="status">
      <strong>{result.duplicate ? 'พบ fixture เดิม — ไม่สร้างซ้ำ' : 'สร้าง fixture สำเร็จ'}</strong>
      {result.employee && <dl className="account-detail-grid"><div><dt>Employee ID</dt><dd>{result.employee.id}</dd></div><div><dt>Account ID</dt><dd>{result.account?.id || 'ไม่พบ'}</dd></div><div><dt>Login</dt><dd>{result.account?.email || 'ไม่พบ'}</dd></div><div><dt>Role</dt><dd>{result.account?.role || 'ไม่พบ'}</dd></div></dl>}
      {result.temporaryPassword && <p><span>Temporary password (แสดงครั้งเดียว): </span><code>{result.temporaryPassword}</code></p>}
      {result.duplicate && <p>ต้องใช้ credential ที่มีอยู่เดิมหรือดำเนินการ reconciliation ตาม governance</p>}
      <p>Provisioning path: GOVERNED_PREVIEW_ONLY · OTP public flow unchanged</p>
    </div>}
    {result?.employee && <div className="g06-uat-provisioning-result">
      <strong>ขั้นถัดไป: เตรียม Attendance UAT วันนี้</strong>
      <p>ใช้ GPS ปัจจุบันเลือก Active Security Site ที่อยู่ข้างในจริง แล้วสร้าง Shift Assignment เฉพาะ fixture วันนี้ โดยไม่แก้ ScheduleApproval</p>
      <button type="button" className="btn-primary" disabled={attendanceBusy} onClick={prepareAttendance}>{attendanceBusy ? 'กำลังตรวจ GPS และเตรียมตารางกะ…' : 'เตรียม Attendance UAT จาก GPS ปัจจุบัน'}</button>
      {attendanceResult && <dl className="account-detail-grid" role="status"><div><dt>Work date</dt><dd>{new Date(attendanceResult.workDate).toLocaleDateString('th-TH')}</dd></div><div><dt>Shift</dt><dd>{attendanceResult.shift.code} · {attendanceResult.shift.startTime}–{attendanceResult.shift.endTime}</dd></div><div><dt>Security Site</dt><dd>{attendanceResult.site.name} ({attendanceResult.site.code})</dd></div><div><dt>Schedule approval</dt><dd>{attendanceResult.approval.status} · rev {attendanceResult.approval.revision}</dd></div></dl>}
      {attendanceResult && <p><strong>{attendanceResult.idempotent ? 'Attendance UAT พร้อมอยู่แล้ว' : 'Attendance UAT พร้อมทดสอบแล้ว'}</strong> · ออกจาก ADMIN แล้วเข้า fixture VIEWER เพื่อทดสอบ “ลงเวลา GPS (UAT)”</p>}
    </div>}
  </section>;
}
