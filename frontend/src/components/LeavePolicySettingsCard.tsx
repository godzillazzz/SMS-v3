import { useEffect, useMemo, useState } from 'react';

type SettingRow = { key?: unknown; value?: unknown };

export type LeavePolicyForm = {
  defaultSickDays: number;
  defaultPersonalDays: number;
  defaultVacationDays: number;
  sickAttachmentRequiredAfterDays: number;
  managerRetroactiveOnBehalfEnabled: boolean;
  managerRetroactiveMaxDaysBack: number;
};

export const leavePolicyKeys = {
  defaultSickDays: 'LEAVE_DEFAULT_SICK_DAYS',
  defaultPersonalDays: 'LEAVE_DEFAULT_PERSONAL_DAYS',
  defaultVacationDays: 'LEAVE_DEFAULT_VACATION_DAYS',
  sickAttachmentRequiredAfterDays: 'LEAVE_SICK_ATTACHMENT_REQUIRED_AFTER_DAYS',
  managerRetroactiveOnBehalfEnabled: 'LEAVE_MANAGER_RETROACTIVE_ON_BEHALF_ENABLED',
  managerRetroactiveMaxDaysBack: 'LEAVE_MANAGER_RETROACTIVE_MAX_DAYS_BACK'
} as const;

export const defaultLeavePolicy: LeavePolicyForm = {
  defaultSickDays: 30,
  defaultPersonalDays: 3,
  defaultVacationDays: 6,
  sickAttachmentRequiredAfterDays: 3,
  managerRetroactiveOnBehalfEnabled: true,
  managerRetroactiveMaxDaysBack: 0
};

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
      setNotice(reason instanceof Error ? reason.message : 'บันทึกนโยบายการลาไม่สำเร็จ');
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
        <small>ใช้เป็นค่า default ในหน้าสร้างโควตา Admin ด้วย</small>
      </label>
      <label className="field-group">
        <span>บังคับเอกสารเมื่อลาป่วยเกิน (วัน)</span>
        <input type="number" min={0} max={30} value={form.sickAttachmentRequiredAfterDays} onChange={(event) => updateNumber('sickAttachmentRequiredAfterDays', event.target.value)} />
        <small>0 = ลาป่วยทุกจำนวนวันต้องแนบเอกสาร</small>
      </label>
      <label className="field-group">
        <span>Manager บันทึกลาย้อนหลังแทนพนักงาน</span>
        <select value={form.managerRetroactiveOnBehalfEnabled ? 'true' : 'false'} onChange={(event) => setForm((current) => ({ ...current, managerRetroactiveOnBehalfEnabled: event.target.value === 'true' }))}>
          <option value="true">อนุญาต</option>
          <option value="false">ไม่อนุญาต</option>
        </select>
        <small>Manager ยังห้ามบันทึกย้อนหลังให้ตัวเองเสมอ</small>
      </label>
      <label className="field-group">
        <span>Manager ย้อนได้สูงสุด (วัน)</span>
        <input type="number" min={0} max={3650} value={form.managerRetroactiveMaxDaysBack} onChange={(event) => updateNumber('managerRetroactiveMaxDaysBack', event.target.value)} />
        <small>0 = ไม่จำกัดระยะย้อนหลัง; Admin authority ไม่ถูกลดด้วยค่านี้</small>
      </label>
    </div>

    <div className="alert alert-info">
      Invariant ที่แก้จากหน้านี้ไม่ได้: Viewer ย้อนหลังไม่ได้, Manager ห้ามย้อนหลังให้ตัวเอง, การลาย้อนหลังต้องมีเหตุผล, และห้ามอนุมัติคำขอของตนเอง
    </div>

    {notice && <div className={notice.includes('สำเร็จ') ? 'settings-notice success' : 'settings-notice error'}>{notice}</div>}
    <div className="line-settings-actions">
      <button className="btn-primary compact" disabled={saving} onClick={() => void save()}>💾 {saving ? 'กำลังบันทึก…' : 'บันทึกนโยบายการลา'}</button>
      <button className="btn-neutral small-action" disabled={saving} onClick={() => { setForm(defaultLeavePolicy); setNotice(undefined); }}>คืนค่าเริ่มต้น</button>
      <button className="btn-neutral small-action" disabled={saving} onClick={onRefresh}>↻ รีเฟรช</button>
    </div>
    <p className="line-settings-footnote">การเปลี่ยนนโยบายมีผลกับการตัดสินใจและการสร้างข้อมูลใหม่หลังบันทึกเท่านั้น ส่วนข้อมูลย้อนหลังไม่ถูกแก้ไข และทุกการเปลี่ยนแปลงถูกบันทึก Audit ตามกฎของ Configuration Center</p>
  </section>;
}
