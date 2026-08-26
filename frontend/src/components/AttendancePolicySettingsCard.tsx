import { useEffect, useMemo, useState } from 'react';

type SettingRow = { key?: unknown; value?: unknown };

export type AttendancePolicyForm = {
  qrPolicy: 'ADAPTIVE' | 'REQUIRED' | 'DISABLED';
  maxAccuracyMeters: number;
  maxAgeSeconds: number;
  futureSkewSeconds: number;
  autoPassAccuracyMeters: number;
  innerMarginMeters: number;
  stepUpOnSiteOverlap: boolean;
};

export const attendancePolicyKeys = {
  qrPolicy: 'ATTENDANCE_QR_POLICY',
  maxAccuracyMeters: 'ATTENDANCE_GPS_MAX_ACCURACY_METERS',
  maxAgeSeconds: 'ATTENDANCE_GPS_MAX_AGE_SECONDS',
  futureSkewSeconds: 'ATTENDANCE_GPS_FUTURE_SKEW_SECONDS',
  autoPassAccuracyMeters: 'ATTENDANCE_GPS_AUTO_PASS_ACCURACY_METERS',
  innerMarginMeters: 'ATTENDANCE_GEOFENCE_INNER_MARGIN_METERS',
  stepUpOnSiteOverlap: 'ATTENDANCE_QR_STEP_UP_ON_SITE_OVERLAP'
} as const;

export const defaultAttendancePolicy: AttendancePolicyForm = {
  qrPolicy: 'ADAPTIVE',
  maxAccuracyMeters: 50,
  maxAgeSeconds: 180,
  futureSkewSeconds: 30,
  autoPassAccuracyMeters: 20,
  innerMarginMeters: 20,
  stepUpOnSiteOverlap: true
};

function settingValue(settings: SettingRow[], key: string, fallback: string) {
  const row = settings.find((item) => String(item.key || '') === key);
  return row?.value == null ? fallback : String(row.value);
}

function bounded(value: string, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

function policyFromRows(settings: SettingRow[]): AttendancePolicyForm {
  const qrRaw = settingValue(settings, attendancePolicyKeys.qrPolicy, defaultAttendancePolicy.qrPolicy).toUpperCase();
  const qrPolicy = (['ADAPTIVE', 'REQUIRED', 'DISABLED'] as const).includes(qrRaw as AttendancePolicyForm['qrPolicy'])
    ? qrRaw as AttendancePolicyForm['qrPolicy']
    : defaultAttendancePolicy.qrPolicy;
  const maxAccuracyMeters = bounded(settingValue(settings, attendancePolicyKeys.maxAccuracyMeters, '50'), 50, 5, 100);
  return {
    qrPolicy,
    maxAccuracyMeters,
    maxAgeSeconds: bounded(settingValue(settings, attendancePolicyKeys.maxAgeSeconds, '180'), 180, 30, 600),
    futureSkewSeconds: bounded(settingValue(settings, attendancePolicyKeys.futureSkewSeconds, '30'), 30, 5, 120),
    autoPassAccuracyMeters: Math.min(maxAccuracyMeters, bounded(settingValue(settings, attendancePolicyKeys.autoPassAccuracyMeters, '20'), 20, 3, 50)),
    innerMarginMeters: bounded(settingValue(settings, attendancePolicyKeys.innerMarginMeters, '20'), 20, 0, 100),
    stepUpOnSiteOverlap: settingValue(settings, attendancePolicyKeys.stepUpOnSiteOverlap, 'true').toLowerCase() !== 'false'
  };
}

export function AttendancePolicySettingsCard({ settings, onSave, onRefresh }: {
  settings: SettingRow[];
  onSave(policy: AttendancePolicyForm): Promise<void>;
  onRefresh(): void;
}) {
  const loaded = useMemo(() => policyFromRows(settings), [settings]);
  const [form, setForm] = useState<AttendancePolicyForm>(loaded);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();

  useEffect(() => setForm(loaded), [loaded]);

  const updateNumber = (key: keyof AttendancePolicyForm, value: string) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    setForm((current) => ({ ...current, [key]: number }));
  };

  const validation = form.autoPassAccuracyMeters > form.maxAccuracyMeters
    ? 'ค่า GPS สำหรับ Auto pass ต้องไม่มากกว่าความแม่นยำสูงสุดที่ระบบยอมรับ'
    : undefined;

  const save = async () => {
    if (validation) { setNotice(validation); return; }
    setSaving(true); setNotice(undefined);
    try {
      await onSave(form);
      setNotice('บันทึก Attendance Policy สำเร็จแล้ว');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'บันทึก Attendance Policy ไม่สำเร็จ');
    } finally { setSaving(false); }
  };

  return <section className="line-settings-card attendance-policy-settings-card">
    <div className="line-settings-title"><span>📍</span><div><h2>Attendance Policy</h2><p>Admin ปรับพฤติกรรม GPS / QR Step-up ได้จากหน้านี้โดยไม่ต้องแก้ source code พนักงานยังเห็นเพียงปุ่ม “ลงเวลา” ปุ่มเดียว</p></div></div>
    <div className="line-secure-grid">
      <label className="field-group"><span>QR Policy</span><select value={form.qrPolicy} onChange={(event) => setForm((current) => ({ ...current, qrPolicy: event.target.value as AttendancePolicyForm['qrPolicy'] }))}>
        <option value="ADAPTIVE">Adaptive — GPS ชัดเจนข้าม QR / เสี่ยงค่อย Step-up</option>
        <option value="REQUIRED">Required — บังคับ QR ทุกครั้งหลัง GPS</option>
        <option value="DISABLED">Disabled — ไม่ใช้ QR; GPS ไม่พอให้ fail-closed</option>
      </select><small>QR ไม่สามารถ override การอยู่นอก geofence ได้ทุกโหมด</small></label>
      <label className="field-group"><span>GPS accuracy สูงสุดที่รับได้ (เมตร)</span><input type="number" min={5} max={100} value={form.maxAccuracyMeters} onChange={(event) => updateNumber('maxAccuracyMeters', event.target.value)} /><small>เกินค่านี้ระบบให้ลองอ่าน GPS ใหม่ ไม่เข้าสู่ Face flow</small></label>
      <label className="field-group"><span>GPS accuracy สำหรับ Auto pass (เมตร)</span><input type="number" min={3} max={50} value={form.autoPassAccuracyMeters} onChange={(event) => updateNumber('autoPassAccuracyMeters', event.target.value)} /><small>Adaptive mode: ถ้าแม่นยำกว่านี้และเงื่อนไขอื่นผ่าน จะไม่ถาม QR</small></label>
      <label className="field-group"><span>ระยะเผื่อจากขอบ Geofence (เมตร)</span><input type="number" min={0} max={100} value={form.innerMarginMeters} onChange={(event) => updateNumber('innerMarginMeters', event.target.value)} /><small>อยู่ใกล้ขอบกว่าค่านี้ Adaptive mode จะขอ QR Step-up</small></label>
      <label className="field-group"><span>อายุ GPS สูงสุด (วินาที)</span><input type="number" min={30} max={600} value={form.maxAgeSeconds} onChange={(event) => updateNumber('maxAgeSeconds', event.target.value)} /><small>ตัวอย่างค่าแนะนำ 180 วินาที</small></label>
      <label className="field-group"><span>เวลา GPS อนาคตที่ยอมให้คลาดได้ (วินาที)</span><input type="number" min={5} max={120} value={form.futureSkewSeconds} onChange={(event) => updateNumber('futureSkewSeconds', event.target.value)} /><small>ใช้รับ clock skew เล็กน้อยเท่านั้น</small></label>
      <label className="field-group"><span>QR Step-up เมื่อ Site Geofence ซ้อนกัน</span><select value={form.stepUpOnSiteOverlap ? 'true' : 'false'} onChange={(event) => setForm((current) => ({ ...current, stepUpOnSiteOverlap: event.target.value === 'true' }))}><option value="true">เปิด</option><option value="false">ปิด</option></select><small>ค่าแนะนำ: เปิด เพื่อให้ Server ขอ QR เมื่อ GPS อยู่ได้มากกว่าหนึ่ง Site</small></label>
    </div>
    {notice && <div className={notice.includes('สำเร็จ') ? 'settings-notice success' : 'settings-notice error'}>{notice}</div>}
    <div className="line-settings-actions"><button className="btn-primary compact" disabled={saving || Boolean(validation)} onClick={() => void save()}>💾 {saving ? 'กำลังบันทึก…' : 'บันทึก Attendance Policy'}</button><button className="btn-neutral small-action" disabled={saving} onClick={() => { setForm(defaultAttendancePolicy); setNotice(undefined); }}>คืนค่าแนะนำ</button><button className="btn-neutral small-action" disabled={saving} onClick={onRefresh}>↻ รีเฟรช</button></div>
    <p className="line-settings-footnote">การเปลี่ยนค่าเป็น SystemSetting แบบ Admin-only และมี Audit Log; ค่า secret/provider endpoint ยังคงห้ามเก็บใน Settings นี้</p>
  </section>;
}
