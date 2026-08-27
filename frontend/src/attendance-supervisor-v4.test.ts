import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('./main.tsx');
const client = read('./pages/attendance-supervisor/attendance-supervisor-client.ts');
const page = read('./pages/attendance-supervisor/AttendanceSupervisorPage.tsx');
const css = read('./pages/attendance-supervisor/attendance-supervisor-v4.css');
const adjustmentClient = read('./pages/attendance-supervisor/attendance-adjustment-client.ts');

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

  it('wires governed Manager/Admin request creation without direct Attendance mutation', () => {
    expect(page).toContain('ยืนยันปฏิบัติงาน');
    expect(page).toContain('แก้ไขเวลาปฏิบัติงาน');
    expect(page).toContain("openNewAdjustment('CONFIRM_WORK_PERFORMED')");
    expect(page).toContain("openNewAdjustment('ADJUST_WORK_TIME')");
    expect(page).toContain('ส่งคำขอให้ ADMIN พิจารณา');
    expect(page).toContain('Pending ไม่มีผลต่อ Attendance');
    expect(adjustmentClient).toContain('/attendance/adjustment-requests');
    expect(adjustmentClient).not.toContain('/attendance/governance/assignments/');
  });

  it('adds a dedicated approval queue with explicit ADMIN approve return and reject actions', () => {
    expect(page).toContain("type Mode = 'daily' | 'history' | 'requests'");
    expect(page).toContain('คำขอแก้ไข');
    expect(page).toContain('คิวอนุมัติ Attendance');
    expect(page).toContain('Before');
    expect(page).toContain('After');
    expect(page).toContain('อนุมัติและให้มีผล');
    expect(page).toContain('ส่งกลับให้แก้ไข');
    expect(page).toContain('ยืนยันไม่อนุมัติ');
    expect(page).toContain('admin && request.status === \'PENDING_APPROVAL\'');
  });

  it('keeps Admin keying and approval as separate explicit actions', () => {
    expect(page).toContain('await createAttendanceAdjustment');
    expect(page).toContain('await submitAttendanceAdjustment');
    expect(page).not.toMatch(/createAttendanceAdjustment[\s\S]{0,500}approveAttendanceAdjustment/);
    expect(page).toContain('ยังไม่มีผลต่อ Attendance จนกว่าจะกดอนุมัติแยกต่างหาก');
  });

  it('uses a responsive corporate control-center visual system', () => {
    expect(css).toContain('.attendance-supervisor-v4__kpis');
    expect(css).toContain('grid-template-columns: repeat(6, minmax(120px, 1fr));');
    expect(css).toContain('.attendance-supervisor-v4__workflow-modal');
    expect(css).toContain('.attendance-supervisor-v4__request-card');
    expect(css).toContain('.attendance-supervisor-v4__drawer');
    expect(css).toContain('@media (max-width: 820px)');
    expect(css).toContain('@media (max-width: 520px)');
  });
});
