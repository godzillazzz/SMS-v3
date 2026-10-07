import { DataTableState, ResponsiveDataTable } from './ResponsiveDataTable';
import { attendancePolicyKeys, defaultAttendancePolicy } from './attendance-policy-contract';
import { defaultLeavePolicy, leavePolicyKeys } from './leave-policy-contract';

type SettingRow = {
  key?: unknown;
  value?: unknown;
  configured?: unknown;
  description?: unknown;
  updatedAt?: unknown;
  group?: unknown;
  groupLabel?: unknown;
  label?: unknown;
  valueType?: unknown;
  editable?: unknown;
  authority?: unknown;
  registryStatus?: unknown;
  constraints?: unknown;
};

function text(value: unknown, fallback = '—') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

export function configurationDescriptionText(value: unknown) {
  const normalized = String(value ?? '')
    .replace(/\bCFG-06\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.;,:])/g, '$1')
    .trim();
  return normalized || '—';
}

function statusLabel(row: SettingRow) {
  if (row.registryStatus === 'PROTECTED') return 'อยู่ภายใต้ขั้นตอนกำกับ';
  if (row.registryStatus === 'UNREGISTERED') return 'ค่าเดิม · อ่านอย่างเดียว';
  return row.configured ? 'กำหนดค่าแล้ว' : 'ใช้ค่าเริ่มต้น';
}

const knownDefaults: Record<string, unknown> = {
  [attendancePolicyKeys.qrPolicy]: defaultAttendancePolicy.qrPolicy,
  [attendancePolicyKeys.maxAccuracyMeters]: defaultAttendancePolicy.maxAccuracyMeters,
  [attendancePolicyKeys.maxAgeSeconds]: defaultAttendancePolicy.maxAgeSeconds,
  [attendancePolicyKeys.futureSkewSeconds]: defaultAttendancePolicy.futureSkewSeconds,
  [attendancePolicyKeys.autoPassAccuracyMeters]: defaultAttendancePolicy.autoPassAccuracyMeters,
  [attendancePolicyKeys.innerMarginMeters]: defaultAttendancePolicy.innerMarginMeters,
  [attendancePolicyKeys.stepUpOnSiteOverlap]: defaultAttendancePolicy.stepUpOnSiteOverlap,
  [leavePolicyKeys.defaultSickDays]: defaultLeavePolicy.defaultSickDays,
  [leavePolicyKeys.defaultPersonalDays]: defaultLeavePolicy.defaultPersonalDays,
  [leavePolicyKeys.defaultVacationDays]: defaultLeavePolicy.defaultVacationDays,
  [leavePolicyKeys.sickAttachmentRequiredAfterDays]: defaultLeavePolicy.sickAttachmentRequiredAfterDays,
  [leavePolicyKeys.managerRetroactiveOnBehalfEnabled]: defaultLeavePolicy.managerRetroactiveOnBehalfEnabled,
  [leavePolicyKeys.managerRetroactiveMaxDaysBack]: defaultLeavePolicy.managerRetroactiveMaxDaysBack
};

function displayValue(value: unknown): string {
  if (typeof value === 'boolean' || value === 'true' || value === 'false') return String(value) === 'true' ? 'เปิด' : 'ปิด';
  if (value === 'ADAPTIVE') return 'ปรับตามเงื่อนไข';
  if (value === 'REQUIRED') return 'ต้องใช้ QR';
  if (value === 'DISABLED') return 'ไม่ใช้ QR';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(' · ') || 'ไม่มีรายการ';
  if (value && typeof value === 'object') return JSON.stringify(value);
  const normalized = String(value ?? '').trim();
  if (!normalized) return '—';
  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) return displayValue(parsed);
  } catch { /* Plain text values remain readable as entered. */ }
  return normalized;
}

function currentValueLabel(row: SettingRow): string {
  if (row.registryStatus === 'PROTECTED') return 'จัดการผ่านขั้นตอนที่กำกับ';
  if (row.configured) return displayValue(row.value);
  if (typeof row.key === 'string' && row.key in knownDefaults) return `${displayValue(knownDefaults[row.key])} · ค่าเริ่มต้น`;
  if (row.registryStatus === 'REGISTERED' && row.group === 'NOTIFICATIONS') return 'ใช้ข้อความตั้งต้นในหมวดแจ้งเตือน';
  if (row.registryStatus === 'REGISTERED') return 'ใช้ค่าที่ระบบกำหนด · ตรวจสอบในหมวดนี้';
  return 'ยังไม่มีค่าที่บันทึก';
}

function constraintLabel(row: SettingRow) {
  const constraints = row.constraints && typeof row.constraints === 'object'
    ? row.constraints as Record<string, unknown>
    : {};
  if (Array.isArray(constraints.allowedValues)) return constraints.allowedValues.map(displayValue).join(' · ');
  const parts = [];
  if (constraints.min !== undefined || constraints.max !== undefined) {
    parts.push(`${constraints.min ?? '—'}–${constraints.max ?? '—'}`);
  }
  if (constraints.unit) parts.push(({ meters: 'เมตร', seconds: 'วินาที', days: 'วัน', months: 'เดือน' } as Record<string, string>)[String(constraints.unit)] || String(constraints.unit));
  if (constraints.maxLength) parts.push(`ไม่เกิน ${constraints.maxLength} ตัวอักษร`);
  return parts.join(' · ') || '—';
}

function ConfigurationRegistryCards({ settings }: { settings: SettingRow[] }) {
  if (!settings.length) return <DataTableState variant="empty" title="ยังไม่มี Configuration metadata" description="Registry จะแสดงเฉพาะ metadata ที่ระบบประกาศไว้" />;
  return <div className="configuration-registry-mobile-cards">{settings.map((row) => <article className="configuration-registry-mobile-card data-mobile-card" key={text(row.key)}>
    <header>
      <div><small>{text(row.groupLabel)}</small><h3>{text(row.label, text(row.key))}</h3></div>
      <span className={`status-badge ${row.registryStatus === 'REGISTERED' ? (row.configured ? 'active' : 'pending') : 'inactive'}`}>{statusLabel(row)}</span>
    </header>
    <p className="configuration-setting-description">{configurationDescriptionText(row.description)}</p>
    <dl>
      <div><dt>ค่าปัจจุบัน</dt><dd>{currentValueLabel(row)}</dd></div>
      <div><dt>ช่วง / ตัวเลือก</dt><dd>{constraintLabel(row)}</dd></div>
    </dl>
    <details className="configuration-setting-technical"><summary>รายละเอียดทางเทคนิค</summary><dl><div><dt>Key</dt><dd><code>{text(row.key)}</code></dd></div><div><dt>ชนิดข้อมูล</dt><dd>{text(row.valueType)}</dd></div><div><dt>ผู้กำหนดค่า</dt><dd><code>{text(row.authority)}</code></dd></div></dl></details>
  </article>)}</div>;
}

export function ConfigurationRegistryPanel({ settings }: { settings: SettingRow[] }) {
  const registered = settings.filter((row) => row.registryStatus === 'REGISTERED');
  const configured = registered.filter((row) => Boolean(row.configured));
  const legacy = settings.filter((row) => row.registryStatus === 'UNREGISTERED');
  const protectedRows = settings.filter((row) => row.registryStatus === 'PROTECTED');
  const groups = Array.from(new Map(
    registered.map((row) => [text(row.group), text(row.groupLabel, text(row.group))])
  ).entries());

  return <section className="configuration-registry" aria-label="Governed configuration registry">
    <div className="configuration-registry__intro">
      <div>
        <p className="eyebrow">ค่าที่ระบบกำหนด</p>
        <h2>รายการตั้งค่าระบบ</h2>
        <p>แก้ไขได้เฉพาะ key ที่ระบบ register และ validate ไว้แล้ว ส่วน legacy, secret และ operational settings เป็น read-only หรือใช้ protected workflow เท่านั้น</p>
      </div>
      <span className="record-chip">{registered.length} รายการ</span>
    </div>

    <div className="configuration-registry__metrics">
      <article><span>ค่าที่ระบบรองรับ</span><strong>{registered.length}</strong><small>{groups.length} หมวด</small></article>
      <article><span>กำหนดค่าเฉพาะแล้ว</span><strong>{configured.length}</strong><small>บันทึกไว้ในระบบ</small></article>
      <article><span>ค่าเดิม · อ่านอย่างเดียว</span><strong>{legacy.length}</strong><small>แก้ไขไม่ได้จากหน้านี้</small></article>
      <article><span>อยู่ภายใต้ขั้นตอนกำกับ</span><strong>{protectedRows.length}</strong><small>จัดการผ่านขั้นตอนเฉพาะ</small></article>
    </div>

    <div className="configuration-registry__domains">
      {groups.map(([id, label]) => {
        const rows = registered.filter((row) => text(row.group) === id);
        const configuredCount = rows.filter((row) => Boolean(row.configured)).length;
        return <div key={id} className="configuration-domain-chip">
          <strong>{label}</strong>
          <span>{configuredCount}/{rows.length} กำหนดค่าเฉพาะ</span>
        </div>;
      })}
    </div>

    <div className="table-card configuration-registry__table">
      <ResponsiveDataTable ariaLabel="Governed configuration registry" hasRows={settings.length > 0} className="configuration-registry-responsive-table" desktop={<div className="data-table-scroll"><table className="data-surface-table configuration-registry-data-table" aria-label="Governed configuration registry"><thead>
        <tr><th scope="col">หมวด</th><th scope="col">รายการตั้งค่า</th><th scope="col">ค่าปัจจุบัน</th><th scope="col">ช่วง / ตัวเลือก</th><th scope="col">สถานะ</th><th scope="col">รายละเอียดทางเทคนิค</th></tr>
      </thead><tbody>
        {settings.length ? settings.map((row) => <tr key={text(row.key)}>
          <td>{text(row.groupLabel)}</td>
          <td><strong>{text(row.label, text(row.key))}</strong><small className="configuration-setting-description">{configurationDescriptionText(row.description)}</small></td>
          <td className="configuration-registry__current-value">{currentValueLabel(row)}</td>
          <td>{constraintLabel(row)}</td>
          <td><span className={`status-badge ${row.registryStatus === 'REGISTERED' ? (row.configured ? 'active' : 'pending') : 'inactive'}`}>{statusLabel(row)}</span></td>
          <td><details className="configuration-setting-technical"><summary>ดู key และแหล่งอำนาจ</summary><dl><div><dt>Key</dt><dd><code>{text(row.key)}</code></dd></div><div><dt>ชนิดข้อมูล</dt><dd>{text(row.valueType)}</dd></div><div><dt>ผู้กำหนดค่า</dt><dd><code>{text(row.authority)}</code></dd></div></dl></details></td>
        </tr>) : <tr><td colSpan={6} className="data-table-empty-cell"><DataTableState variant="empty" title="ยังไม่มีรายการตั้งค่าระบบ" description="จะแสดงเฉพาะค่าที่ระบบประกาศไว้" announce={false} /></td></tr>}
      </tbody></table></div>} mobile={<ConfigurationRegistryCards settings={settings} />} />
    </div>

    <p className="configuration-registry__footnote">รายการนี้ไม่แสดงค่า secret และไม่ใช่หน้าควบคุม deployment; key ที่ยังไม่ได้ register จะไม่สามารถสร้างหรือแก้ผ่าน API ตั้งค่าระบบได้</p>
  </section>;
}
