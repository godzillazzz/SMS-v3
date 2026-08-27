import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('./main.tsx');
const client = read('./pages/attendance-supervisor/attendance-supervisor-client.ts');
const page = read('./pages/attendance-supervisor/AttendanceSupervisorPage.tsx');
const css = read('./pages/attendance-supervisor/attendance-supervisor-v4.css');

describe('Attendance Supervisor UX V4', () => {
  it('reuses the existing Attendance destination for Manager/Admin without changing certified navigation IDs', () => {
    expect(main).toContain("activePage === 'attendance' && auth.token");
    expect(main).toContain("!pwaShell && ['ADMIN', 'MANAGER'].includes(auth.user?.role || '')");
    expect(main).toContain('<AttendanceSupervisorPage');
    expect(main).not.toContain("id: 'attendanceSupervisor'");
  });

  it('isolates daily history and detail clients from the locked core API surface', () => {
    expect(client).toContain('/attendance/supervisor/daily');
    expect(client).toContain('/attendance/supervisor/history');
    expect(client).toContain('/attendance/supervisor/assignments/');
    expect(client).toContain('/detail');
  });

  it('implements approved dashboard filters and KPI/read-model fields', () => {
    for (const label of ['Department', 'Site', 'Shift', 'Employee', 'Status']) expect(page).toContain(label);
    for (const label of ['Scheduled', 'Checked in', 'Working now', 'Not checked in', 'Late', 'Early out', 'Wrong shift', 'Assist other Site', 'Outside Site', 'Leave', 'Absent', 'Time abnormal']) {
      expect(page).toContain(label);
    }
    for (const column of ['Expected Site', 'Actual Site', 'Worked', 'Flags', 'Action']) expect(page).toContain(column);
  });

  it('shows original versus effective Attendance and immutable raw events in the detail drawer', () => {
    expect(page).toContain('Original → Effective');
    expect(page).toContain('Immutable Attendance Events');
    expect(page).toContain('originalCheckInAt');
    expect(page).toContain('originalCheckOutAt');
    expect(page).toContain('rawEvents');
    expect(page).toContain('LEGACY_CURRENT_CORRECTION_OVERLAY');
  });

  it('fails closed adjustment actions until governed request backend is enabled', () => {
    expect(page).toContain('ยืนยันปฏิบัติงาน');
    expect(page).toContain('แก้ไขเวลาปฏิบัติงาน');
    expect(page).toContain('disabled title="เปิดใช้งานหลัง Governed Adjustment V4 backend พร้อม"');
    expect(page).toContain('ไม่ให้ Correction V1 เดิมเปลี่ยน Attendance ก่อน ADMIN approval');
  });

  it('uses a responsive corporate control-center visual system', () => {
    expect(css).toContain('.attendance-supervisor-v4__kpis');
    expect(css).toContain('grid-template-columns: repeat(6, minmax(120px, 1fr));');
    expect(css).toContain('.attendance-supervisor-v4__drawer');
    expect(css).toContain('@media (max-width: 820px)');
    expect(css).toContain('@media (max-width: 520px)');
  });
});
