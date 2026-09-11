import { useState } from 'react';

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

type Props = { onProvision(): Promise<G06UatProvisionResult> };

export function G06UatProvisioningPanel({ onProvision }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<G06UatProvisionResult>();

  const provision = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setResult(await onProvision());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ไม่สามารถสร้าง Preview UAT fixture ได้');
    } finally {
      setBusy(false);
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
  </section>;
}
