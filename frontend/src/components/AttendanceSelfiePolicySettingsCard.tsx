import { useCallback, useEffect, useState } from 'react';
import { loadAttendanceSelfiePolicies, saveAttendanceSelfiePolicy, type AttendanceSelfiePolicy } from '../attendance-selfie-policy-client';

type Props = { token: string };
const roles: AttendanceSelfiePolicy['role'][] = ['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER'];
const labels: Record<AttendanceSelfiePolicy['role'], string> = { ADMIN: 'ADMIN', MANAGER: 'ผู้จัดการ', SUPERVISOR: 'หัวหน้างาน', VIEWER: 'พนักงาน' };

export function AttendanceSelfiePolicySettingsCard({ token }: Props) {
  const [rows, setRows] = useState<AttendanceSelfiePolicy[]>([]); const [busy, setBusy] = useState(true); const [saving, setSaving] = useState<string | null>(null); const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const refresh = useCallback(async () => { setBusy(true); setError(''); try { setRows(await loadAttendanceSelfiePolicies(token)); } catch (e) { setError(e instanceof Error ? e.message : 'โหลดนโยบายไม่สำเร็จ'); } finally { setBusy(false); } }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);
  const update = async (row: AttendanceSelfiePolicy, key: 'clockInRequired' | 'clockOutRequired', value: boolean) => { const next = { ...row, [key]: value }; setRows((current) => current.map((item) => item.role === row.role ? next : item)); setSaving(row.role); setNotice(''); setError(''); try { const saved = await saveAttendanceSelfiePolicy(token, next); setRows((current) => current.map((item) => item.role === row.role ? saved : item)); setNotice(`บันทึกนโยบาย ${labels[row.role]} แล้ว`); } catch (e) { setRows((current) => current.map((item) => item.role === row.role ? row : item)); setError(e instanceof Error ? e.message : 'บันทึกนโยบายไม่สำเร็จ'); } finally { setSaving(null); } };
  return <section className="line-settings-card attendance-selfie-policy-settings-card" aria-label="นโยบาย Selfie ตามบทบาท" aria-busy={busy}>
    <div className="line-settings-title"><span>◎</span><div><h2>นโยบาย Selfie สำหรับลงเวลา</h2><p>ADMIN กำหนดแยกการลงเวลาเข้าและออกได้ ค่าเริ่มต้นของทุกบทบาทคือปิด และไม่ขึ้นกับอุปกรณ์หรือเบราว์เซอร์</p></div></div>
    {busy && <div role="status">กำลังโหลดนโยบาย Selfie…</div>}
    {!busy && <div className="line-secure-grid">{roles.map((role) => { const row = rows.find((item) => item.role === role) || { role, clockInRequired: false, clockOutRequired: false }; return <fieldset key={role} disabled={saving === role}><legend>{labels[role]}</legend><label><input type="checkbox" checked={row.clockInRequired} onChange={(e) => void update(row, 'clockInRequired', e.target.checked)} /> ลงเวลาเข้า</label><label><input type="checkbox" checked={row.clockOutRequired} onChange={(e) => void update(row, 'clockOutRequired', e.target.checked)} /> ลงเวลาออก</label></fieldset>; })}</div>}
    {error && <div role="alert">{error}</div>}{notice && <div role="status">{notice}</div>}
    <button type="button" className="btn-neutral small-action" disabled={busy || Boolean(saving)} onClick={() => void refresh()}>↻ รีเฟรช</button>
  </section>;
}
