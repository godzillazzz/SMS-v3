import { useEffect, useMemo, useState } from 'react';
import { formatRequestErrorMessage } from '../request-error';
import { roleDisplayName } from '../role-display';
import { defaultLeavePolicy, leavePolicyKeys, type LeavePolicyForm } from './leave-policy-contract';
export { defaultLeavePolicy, leavePolicyKeys, type LeavePolicyForm } from './leave-policy-contract';

type SettingRow = { key?: unknown; value?: unknown };

function settingValue(settings: SettingRow[], key: string, fallback: string) {
  const row = settings.find((item) => String(item.key || '') === key);
  return row?.value == null ? fallback : String(row.value);
}

function bounded(value: string, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

function policyFromRows(settings: SettingRow[]): LeavePolicyForm {
  return {
    defaultSickDays: bounded(settingValue(settings, leavePolicyKeys.defaultSickDays, '30'), 30, 0, 999),
    defaultPersonalDays: bounded(settingValue(settings, leavePolicyKeys.defaultPersonalDays, '3'), 3, 0, 999),
    defaultVacationDays: bounded(settingValue(settings, leavePolicyKeys.defaultVacationDays, '6'), 6, 0, 999),
    sickAttachmentRequiredAfterDays: bounded(settingValue(settings, leavePolicyKeys.sickAttachmentRequiredAfterDays, '3'), 3, 0, 30),
    managerRetroactiveOnBehalfEnabled: settingValue(settings, leavePolicyKeys.managerRetroactiveOnBehalfEnabled, 'true').toLowerCase() !== 'false',
    managerRetroactiveMaxDaysBack: bounded(settingValue(settings, leavePolicyKeys.managerRetroactiveMaxDaysBack, '0'), 0, 0, 3650)
  };
}

export function LeavePolicySettingsCard({ settings, onSave, onRefresh }: {
  settings: SettingRow[];
  onSave(policy: LeavePolicyForm): Promise<void>;
  onRefresh(): void;
}) {
  const loaded = useMemo(() => policyFromRows(settings), [settings]);
  const [form, setForm] = useState<LeavePolicyForm>(loaded);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();

  useEffect(() => setForm(loaded), [loaded]);

  const updateNumber = (key: keyof LeavePolicyForm, value: string) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    setForm((current) => ({ ...current, [key]: number }));
  };

  const save = async () => {
    setSaving(true);
    setNotice(undefined);
    try {
      await onSave(form);
      setNotice('บันทึกนโยบายการลาสำเร็จแล้ว');
    } catch (reason) {
      setNotice(formatRequestErrorMessage(reason, 'บันทึกนโยบายการลาไม่สำเร็จ'));
    } finally {
      setSaving(false);
    }
  };

  return <section className="line-settings-card leave-policy-settings-card">
    <div className="line-settings-title">
      <span>🗓️</span>
      <div>
        <h2>นโยบายการลา</h2>
        <p>กำหนดค่าเริ่มต้นสำหรับโควตาใหม่และกฎยื่นลาปัจจุบัน โดยไม่แก้โควตาหรือคำขอลาในอดีตย้อนหลัง</p>
      </div>
    </div>

    <div className="line-secure-grid">
      <label className="field-group">
        <span>สิทธิ์ลาป่วยเริ่มต้น (วัน/ปี)</span>
        <input type="number" min={0} max={999} value={form.defaultSickDays} onChange={(event) => updateNumber('defaultSickDays', event.target.value)} />
        <small>ใช้เฉพาะเมื่อระบบสร้างโควตารายปีใหม่</small>
      </label>
      <label className="field-group">
        <span>สิทธิ์ลากิจเริ่มต้น (วัน/ปี)</span>
        <input type="number" min={0} max={999} value={form.defaultPersonalDays} onChange={(event) => updateNumber('defaultPersonalDays', event.target.value)} />
        <small>โควตาที่มีอยู่แล้วจะไม่ถูกเขียนทับ</small>
      </label>
      <label className="field-group">
        <span>สิทธิ์ลาพักร้อนเริ่มต้น (วัน/ปี)</span>
        <input type="number" min={0} max={999} value={form.defaultVacationDays} onChange={(event) => updateNumber('defaultVacationDays', event.target.value)} />
        <small>ใช้เป็นค่าเริ่มต้นในหน้าสร้างโควตาของ {roleDisplayName('ADMIN')} ด้วย</small>
      </label>
      <label className="field-group">
        <span>บังคับเอกสารเมื่อลาป่วยเกิน (วัน)</span>
        <input type="number" min={0} max={30} value={form.sickAttachmentRequiredAfterDays} onChange={(event) => updateNumber('sickAttachmentRequiredAfterDays', event.target.value)} />
        <small>0 = ลาป่วยทุกจำนวนวันต้องแนบเอกสาร</small>
      </label>
      <label className="field-group">
        <span>{roleDisplayName('MANAGER')} บันทึกลาย้อนหลังแทนพนักงาน</span>
        <select value={form.managerRetroactiveOnBehalfEnabled ? 'true' : 'false'} onChange={(event) => setForm((current) => ({ ...current, managerRetroactiveOnBehalfEnabled: event.target.value === 'true' }))}>
          <option value="true">อนุญาต</option>
          <option value="false">ไม่อนุญาต</option>
        </select>
        <small>{roleDisplayName('MANAGER')} ยังห้ามบันทึกย้อนหลังให้ตนเองเสมอ</small>
      </label>
      <label className="field-group">
        <span>{roleDisplayName('MANAGER')} ย้อนได้สูงสุด (วัน)</span>
        <input type="number" min={0} max={3650} value={form.managerRetroactiveMaxDaysBack} onChange={(event) => updateNumber('managerRetroactiveMaxDaysBack', event.target.value)} />
        <small>0 = ไม่จำกัดระยะย้อนหลัง; ค่านี้ไม่ลดอำนาจของ{roleDisplayName('ADMIN')}</small>
      </label>
    </div>

    <div className="alert alert-info">
      ข้อบังคับที่แก้จากหน้านี้ไม่ได้: {roleDisplayName('VIEWER')} บันทึกย้อนหลังไม่ได้, {roleDisplayName('MANAGER')} ห้ามบันทึกย้อนหลังให้ตนเอง, การลาย้อนหลังต้องมีเหตุผล และห้ามอนุมัติคำขอของตนเอง
    </div>

    {notice && <div className={notice.includes('สำเร็จ') ? 'settings-notice success' : 'settings-notice error'}>{notice}</div>}
    <div className="line-settings-actions">
      <button className="btn-primary compact" disabled={saving} onClick={() => void save()}>💾 {saving ? 'กำลังบันทึก…' : 'บันทึกนโยบายการลา'}</button>
      <button className="btn-neutral small-action" disabled={saving} onClick={() => { setForm(defaultLeavePolicy); setNotice(undefined); }}>คืนค่าเริ่มต้น</button>
      <button className="btn-neutral small-action" disabled={saving} onClick={onRefresh}>↻ รีเฟรช</button>
    </div>
    <p className="line-settings-footnote">การเปลี่ยนนโยบายมีผลกับการตัดสินใจและการสร้างข้อมูลใหม่หลังบันทึกเท่านั้น ส่วนข้อมูลย้อนหลังไม่ถูกแก้ไข และทุกการเปลี่ยนแปลงมีบันทึกตรวจสอบตามกฎของการตั้งค่าระบบ</p>
  </section>;
}
