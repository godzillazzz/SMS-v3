import type { PersonnelRecord } from './types';
import { formatThaiDate } from '../../thai-date-time';

const blank = '–';
const date = (value?: string | null) => value && !Number.isNaN(new Date(value).getTime()) ? formatThaiDate(value, { dateStyle: 'medium' }) : blank;
export function serviceLength(value?: string | null, now = new Date()) {
  if (!value) return blank;
  const start = new Date(value);
  if (Number.isNaN(start.getTime()) || start > now) return blank;
  let months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + now.getUTCMonth() - start.getUTCMonth();
  if (now.getUTCDate() < start.getUTCDate()) months--;
  return `${Math.floor(months / 12)} ปี ${months % 12} เดือน`;
}
export function registerSummary(rows: PersonnelRecord[]) {
  return { total: rows.length, active: rows.filter(r => r.isActive === true).length, probation: blank, leave: blank, suspended: blank, separated: rows.filter(r => r.isActive === false).length };
}
export function EmployeeRegisterPrint({ rows, now = new Date() }: { rows: PersonnelRecord[]; now?: Date }) {
  const s = registerSummary(rows);
  return <article id="personnel-register-print" className="personnel-print personnel-register-print">
    <header className="personnel-register-print__header">
      <div className="personnel-register-print__brand">
        <span className="personnel-register-print__brand-mark" aria-hidden="true">SMS</span>
        <strong className="personnel-register-print__brand-name">Security Management System</strong>
      </div>
      <div className="personnel-register-print__title-block">
        <h1>ทะเบียนรายชื่อพนักงาน</h1>
        <strong className="personnel-register-print__english-title">EMPLOYEE REGISTER</strong>
        <span>ข้อมูล ณ วันที่ {date(now.toISOString())}</span>
        <span>จำนวน {rows.length} คน</span>
      </div>
    </header>
    <div className="personnel-register-print__accent-rule" aria-hidden="true" />
    <p className="personnel-register-print__summary">ทั้งหมด {s.total} · ใช้งาน {s.active} · ทดลองงาน {s.probation} · ลา {s.leave} · พักงาน {s.suspended} · ไม่ใช้งาน {s.separated}</p>
    <table className="personnel-register-print__table"><thead><tr>{['รหัส', 'ชื่อ-สกุล', 'แผนก', 'ตำแหน่ง', 'ประเภท', 'วันเริ่มงาน', 'อายุงาน', 'โทรศัพท์', 'สถานะ'].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.id}><td>{r.employeeCode || blank}</td><td>{`${r.firstName || ''} ${r.lastName || ''}`.trim() || blank}</td><td>{r.department || blank}</td><td>{r.jobTitle || blank}</td><td>{blank}</td><td>{date(r.hiredAt)}</td><td>{serviceLength(r.hiredAt, now)}</td><td>{r.phone || blank}</td><td>{r.isActive === true ? 'ใช้งาน' : r.isActive === false ? 'ไม่ใช้งาน' : blank}</td></tr>)}</tbody></table>
    <div className="personnel-register-print__signatures">
      <span>ผู้จัดทำ .................................... วันที่ ....................</span>
      <span>ผู้ตรวจสอบ .................................... วันที่ ....................</span>
    </div>
  </article>;
}
type Leave = { id: string; leaveTypeNameSnapshot?: string; leaveType?: string; startDate?: string; endDate?: string; dayCount?: number; status?: string };
export function EmployeeRecordPrint({ employee, quota, leaves, now = new Date() }: { employee: PersonnelRecord; quota?: Record<string, unknown>; leaves?: Leave[]; now?: Date }) {
  const fields: Array<[string, unknown]> = [['รหัสพนักงาน', employee.employeeCode], ['ชื่อ-สกุล', `${employee.firstName || ''} ${employee.lastName || ''}`.trim()], ['แผนก', employee.department], ['ตำแหน่ง', employee.jobTitle], ['วันเริ่มงาน', date(employee.hiredAt)], ['อายุงาน', serviceLength(employee.hiredAt, now)], ['โทรศัพท์', employee.phone], ['อีเมล', employee.email], ['เลขประจำตัวประชาชน', null], ['วันเกิด', null], ['ที่อยู่', null], ['ผู้ติดต่อฉุกเฉิน', null], ['เงินเดือน', null]];
  return <article id="personnel-record-print" className="personnel-print"><h1>ทะเบียนประวัติพนักงานรายบุคคล</h1><strong>ลับ CONFIDENTIAL</strong><p>วันที่พิมพ์ {date(now.toISOString())}</p><dl>{fields.map(([label, value]) => <div className="personnel-record-print__field" key={label}><dt>{label}</dt><dd>{value == null || value === '' ? blank : String(value)}</dd></div>)}</dl><h2>โควตาวันลา พ.ศ. {now.getFullYear() + 543}</h2><table className="personnel-record-print__quota"><thead><tr><th>ประเภท</th><th>สิทธิ์</th><th>ใช้</th><th>คงเหลือ</th></tr></thead><tbody>{[['ลาป่วย', 'sickLeave'], ['ลากิจ', 'personalLeave'], ['ลาพักร้อน', 'vacationLeave']].map(([label, key]) => <tr key={key}><td>{label}</td>{[key, `${key}Used`, `${key}Remaining`].map(k => <td key={k}>{quota?.[k] == null ? blank : String(quota[k])}</td>)}</tr>)}</tbody></table><h2>ประวัติการลา (ปีปัจจุบัน สูงสุด 100 รายการ)</h2><div className="personnel-record-print__history">{leaves === undefined ? 'ไม่สามารถโหลดประวัติการลาได้' : leaves.length ? leaves.map(l => <p key={l.id}>{l.leaveTypeNameSnapshot || l.leaveType || blank} · {date(l.startDate)} – {date(l.endDate)} · {l.dayCount ?? blank} วัน · {l.status === 'APPROVED' ? 'อนุมัติ' : l.status || blank}</p>) : 'ไม่มีรายการในปีนี้'}</div><h2>ประวัติการฝึกอบรม</h2><p className="personnel-record-print__training">{blank}</p><p>ผู้จัดทำ .................................... วันที่ ....................　 ผู้ตรวจสอบ .................................... วันที่ ....................</p></article>;
}
