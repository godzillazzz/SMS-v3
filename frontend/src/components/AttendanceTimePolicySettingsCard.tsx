import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatRequestErrorMessage } from '../request-error';
import {
  loadAttendanceTimePolicies,
  saveAttendanceTimePolicy,
  type AttendanceTimePolicy,
  type AttendanceTimePolicyList,
  type AttendanceTimePolicyScope
} from '../attendance-time-policy-client';

type Props = { token: string };
type PolicyKey = keyof AttendanceTimePolicy;

function bangkokDateTimeValue(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function parseBangkokDateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+07:00`);
  return Number.isNaN(date.getTime()) || bangkokDateTimeValue(date) !== value ? null : date;
}

export const attendanceTimePolicyDateTime = { format: bangkokDateTimeValue, parse: parseBangkokDateTime };

function policyForEditor(data: AttendanceTimePolicyList, scopeType: AttendanceTimePolicyScope, scopeId: string) {
  const now = new Date(data.now).getTime();
  const rows = data.policies.filter((row) => {
    if (new Date(row.effectiveFrom).getTime() > now) return false;
    if (scopeType === 'COMPANY') return row.scopeType === 'COMPANY';
    if (scopeType === 'SITE') return row.scopeType === 'SITE' && row.siteId === scopeId;
    return row.scopeType === 'SHIFT_TYPE' && row.shiftTypeId === scopeId;
  }).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  if (rows[0]) return { policy: rows[0].policy, source: rows[0] };
  const companyRows = data.policies.filter((row) => row.scopeType === 'COMPANY' && new Date(row.effectiveFrom).getTime() <= now)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return { policy: companyRows[0]?.policy || data.defaultPolicy, source: null };
}

function numeric(value: string, current: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : current;
}

export function AttendanceTimePolicySettingsCard({ token }: Props) {
  const [data, setData] = useState<AttendanceTimePolicyList>();
  const [scopeType, setScopeType] = useState<AttendanceTimePolicyScope>('COMPANY');
  const [scopeId, setScopeId] = useState('');
  const [form, setForm] = useState<AttendanceTimePolicy>();
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setData(undefined);
    setForm(undefined);
    try { setData(await loadAttendanceTimePolicies(token)); }
    catch (reason) {
      setData(undefined);
      setForm(undefined);
      setLoadError(formatRequestErrorMessage(reason, 'โหลดนโยบายเวลาลงงานไม่สำเร็จ'));
    }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!data) return;
    const selected = policyForEditor(data, scopeType, scopeId);
    setForm({ ...selected.policy });
  }, [data, scopeId, scopeType]);

  const options = useMemo(() => scopeType === 'SITE' ? data?.sites || [] : scopeType === 'SHIFT_TYPE' ? data?.shiftTypes || [] : [], [data, scopeType]);
  const selectedSource = useMemo(() => data ? policyForEditor(data, scopeType, scopeId).source : null, [data, scopeId, scopeType]);

  const updateNumber = (key: PolicyKey, value: string) => {
    setForm((current) => {
      if (!current) return current;
      return { ...current, [key]: numeric(value, Number(current[key]) || 0) } as AttendanceTimePolicy;
    });
  };
  const toggle = (key: PolicyKey, enabled: boolean, initial: number) => {
    setForm((current) => {
      if (!current) return current;
      const next = { ...current, [key]: enabled } as AttendanceTimePolicy;
      if (enabled && key === 'latestCheckInEnabled' && next.latestCheckInMinutesAfterStart == null) next.latestCheckInMinutesAfterStart = initial;
      if (enabled && key === 'latestCheckOutEnabled' && next.latestCheckOutMinutesAfterEnd == null) next.latestCheckOutMinutesAfterEnd = initial;
      if (enabled && key === 'maxShiftDurationEnabled' && next.maxShiftDurationMinutes == null) next.maxShiftDurationMinutes = initial;
      return next;
    });
  };

  const save = async () => {
    if (!form || (scopeType !== 'COMPANY' && !scopeId)) { setError('กรุณาเลือก Site หรือประเภทกะก่อนบันทึก'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const selectedDate = effectiveFrom ? parseBangkokDateTime(effectiveFrom) : null;
      if (effectiveFrom && !selectedDate) throw new Error('วันและเวลาประเทศไทยที่เริ่มใช้ไม่ถูกต้อง');
      await saveAttendanceTimePolicy(token, {
        scopeType,
        ...(scopeType === 'SITE' ? { siteId: scopeId } : {}),
        ...(scopeType === 'SHIFT_TYPE' ? { shiftTypeId: scopeId } : {}),
        ...(selectedDate ? { effectiveFrom: selectedDate.toISOString() } : {}),
        policy: form
      });
      setNotice('บันทึกนโยบายเวลาแล้ว · มีผลตามวันและเวลาที่กำหนด');
      setEffectiveFrom('');
      await refresh();
    } catch (reason) { setError(formatRequestErrorMessage(reason, 'บันทึกนโยบายเวลาลงงานไม่สำเร็จ')); }
    finally { setSaving(false); }
  };

  const numericField = (key: PolicyKey, label: string, min: number, max: number, disabled = false) => {
    if (!form) return null;
    return <label className="field-group" key={key}><span>{label}</span><input type="number" min={min} max={max} step={1} disabled={disabled || saving} value={form[key] == null ? '' : Number(form[key])} onChange={(event) => updateNumber(key, event.target.value)} /></label>;
  };
  const booleanField = (key: PolicyKey, label: string, help: string, initial: number) => {
    if (!form) return null;
    const checked = Boolean(form[key]);
    return <label className="field-group" key={key}><span>{label}</span><select value={checked ? 'true' : 'false'} disabled={saving} onChange={(event) => toggle(key, event.target.value === 'true', initial)}><option value="false">ปิด</option><option value="true">เปิด</option></select><small>{help}</small></label>;
  };

  return <section className="line-settings-card attendance-policy-settings-card" aria-label="นโยบายเวลาลงงาน" aria-busy={loading}>
    <div className="line-settings-title"><span>◷</span><div><h2>นโยบายเวลาลงงาน</h2><p>ปรับการจัดประเภทเวลาและช่วงที่อนุญาตลงเวลาได้ โดยมาสายยังลงเวลาได้ตามปกติ เว้นแต่ Admin เปิดข้อจำกัดล่าสุด</p></div></div>
    <div className="line-secure-grid">
      <label className="field-group"><span>ระดับการตั้งค่า</span><select value={scopeType} disabled={saving} onChange={(event) => { setScopeType(event.target.value as AttendanceTimePolicyScope); setScopeId(''); }}><option value="COMPANY">ค่าเริ่มต้นบริษัท</option><option value="SITE">รายไซต์</option><option value="SHIFT_TYPE">รายประเภทกะ</option></select></label>
      {scopeType !== 'COMPANY' && <label className="field-group"><span>{scopeType === 'SITE' ? 'Site' : 'ประเภทกะ'}</span><select value={scopeId} disabled={loading || saving} onChange={(event) => setScopeId(event.target.value)}><option value="">เลือก…</option>{options.map((option) => <option key={option.id} value={option.id}>{option.code} — {option.name}</option>)}</select></label>}
      {numericField('lateGraceMinutes', 'ผ่อนผันการมาสาย (นาที)', 0, 360)}
      {booleanField('earliestCheckInEnabled', 'จำกัดเวลาลงเวลาเข้าก่อนกะ', 'ปิดโดยค่าเริ่มต้นเพื่อคงพฤติกรรมเดิม หากเปิดจะกำหนดช่วงก่อนเริ่มกะ', 60)}
      {form?.earliestCheckInEnabled && numericField('earliestCheckInMinutesBeforeStart', 'ลงเวลาเข้าก่อนเริ่มกะได้ (นาที)', 0, 720)}
      {booleanField('latestCheckInEnabled', 'จำกัดเวลาลงเวลาเข้าสูงสุด', 'หากปิด พนักงานที่มาสายยังลงเวลาเข้าได้และระบบบันทึกสถานะสาย', 30)}
      {form?.latestCheckInEnabled && numericField('latestCheckInMinutesAfterStart', 'จำกัดหลังเริ่มกะ (นาที)', 0, 1440)}
      {booleanField('earliestCheckOutEnabled', 'จำกัดเวลาลงเวลาออกเร็วสุด', 'หากเปิด จะอนุญาตออกเมื่อผ่านนาทีที่กำหนดนับจากเริ่มกะ', 0)}
      {form?.earliestCheckOutEnabled && numericField('earliestCheckOutMinutesAfterStart', 'ลงเวลาออกได้หลังเริ่มกะ (นาที)', 0, 2880)}
      {booleanField('latestCheckOutEnabled', 'จำกัดเวลาลงเวลาออกช้าสุด', 'ปิดโดยค่าเริ่มต้น; เมื่อเปิดจะปฏิเสธการลงเวลาออกหลังช่วงที่กำหนด', 120)}
      {form?.latestCheckOutEnabled && numericField('latestCheckOutMinutesAfterEnd', 'จำกัดหลังเลิกกะ (นาที)', 0, 1440)}
      {booleanField('earlyLeaveEnabled', 'ตรวจการออกก่อนเวลา', 'แสดงสถานะออกก่อนเวลาโดยไม่ลบหรือเปลี่ยนเวลาเหตุการณ์', 0)}
      {form?.earlyLeaveEnabled && numericField('earlyCheckoutToleranceMinutes', 'ผ่อนผันการออกก่อนเวลา (นาที)', 0, 720)}
      {booleanField('missingCheckoutEnabled', 'ตรวจรายการที่ไม่มีเวลาออก', 'สถานะคำนวณจากเวลาเซิร์ฟเวอร์ในรายงาน ไม่ต้องรอให้พนักงานเปิดหน้า', 120)}
      {form?.missingCheckoutEnabled && numericField('missingCheckoutAfterMinutes', 'ถือว่าไม่มีเวลาออกหลังจบกะ (นาที)', 0, 1440)}
      {booleanField('maxShiftDurationEnabled', 'ตรวจเวลากะที่เปิดค้าง', 'แสดงความผิดปกติเมื่อเวลาเปิดกะเกินค่าสูงสุด ไม่สร้างเวลาออกแทน', 720)}
      {form?.maxShiftDurationEnabled && numericField('maxShiftDurationMinutes', 'เวลากะสูงสุด (นาที)', 60, 2880)}
      <label className="field-group"><span>เริ่มใช้นโยบาย (เวลาไทย)</span><input type="datetime-local" value={effectiveFrom} disabled={saving} onChange={(event) => setEffectiveFrom(event.target.value)} /><small>เว้นว่างเพื่อเริ่มใช้ทันทีตามเวลาเซิร์ฟเวอร์ · วันและเวลานี้ตีความเป็น Asia/Bangkok · ย้อนวันที่ไม่ได้</small></label>
    </div>
    {scopeType !== 'COMPANY' && <p className="line-settings-footnote">ค่าที่แสดงเริ่มจากนโยบายบริษัทเมื่อยังไม่มี override ระดับนี้ · override ที่มีผลแล้ว: {selectedSource ? `${selectedSource.scopeType} · ${bangkokDateTimeValue(selectedSource.effectiveFrom).replace('T', ' ')}` : 'ยังไม่มี'}</p>}
    {loading && <div className="settings-notice" role="status">กำลังโหลดนโยบายเวลา…</div>}
    {loadError && <div className="settings-notice error" role="alert"><strong>โหลดนโยบายเวลาไม่สำเร็จ</strong><span>{loadError}</span><span>ยังไม่แสดงค่าเริ่มต้นหรือช่องแก้ไข จนกว่าจะโหลดข้อมูลจากระบบได้</span></div>}
    {!loading && !loadError && data && form && <div className="settings-notice success" role="status">โหลดนโยบายเวลาและรายการ Site/ประเภทกะแล้ว</div>}
    {error && <div className="settings-notice error" role="alert">{error}</div>}
    {notice && <div className="settings-notice success" role="status">{notice}</div>}
    <div className="line-settings-actions"><button type="button" className="btn-primary compact" disabled={saving || loading || !form || (scopeType !== 'COMPANY' && !scopeId)} onClick={() => void save()}>💾 {saving ? 'กำลังบันทึก…' : 'บันทึกนโยบายเวลา'}</button><button type="button" className="btn-neutral small-action" disabled={saving || loading} onClick={() => void refresh()}>↻ รีเฟรช</button></div>
    <p className="line-settings-footnote">ทุกการเปลี่ยนสร้าง policy version แบบ effective-dated และ Audit Log โดยไม่แก้รายการลงเวลาย้อนหลัง · GPS/GEOFENCE, ตารางอนุมัติ, device binding และการป้องกันรายการซ้ำยังบังคับเหมือนเดิม</p>
  </section>;
}
