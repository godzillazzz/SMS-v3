import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('./pages/attendance-supervisor/AttendanceSupervisorPage.tsx');
const client = read('./pages/attendance-supervisor/attendance-supervisor-client.ts');
const adjustmentClient = read('./pages/attendance-supervisor/attendance-adjustment-client.ts');
const css = read('./pages/attendance-supervisor/attendance-supervisor-v4.css');

describe('WAVE 4C Attendance Supervisor authority guard', () => {
  it('keeps role-scoped read models and governed adjustment review boundaries', () => {
    expect(page).toContain("const manager = role === 'MANAGER';");
    expect(page).toContain("const admin = role === 'ADMIN';");
    expect(page).toContain("if (mode === 'requests') return;");
    expect(page).toContain('attendanceSupervisorDaily(token');
    expect(page).toContain('attendanceSupervisorHistory(token');
    expect(page).toContain('attendanceSupervisorDetail(token, assignmentId)');
    expect(page).toContain('listAttendanceAdjustments(token');
    expect(page).toContain('await createAttendanceAdjustment');
    expect(page).toContain('await reviseAttendanceAdjustment');
    expect(page).toContain('await submitAttendanceAdjustment');
    expect(page).toContain('await approveAttendanceAdjustment');
    expect(page).toContain('await returnAttendanceAdjustment');
    expect(page).toContain('await rejectAttendanceAdjustment');
    expect(page).toContain('originalCheckInAt');
    expect(page).toContain('originalCheckOutAt');
    expect(page).toContain('rawEvents');
    expect(page).toContain('EFFECTIVE_ATTENDANCE_CORRECTION');
  });

  it('keeps Attendance Supervisor clients on the dedicated read/adjustment endpoints', () => {
    expect(client).toContain('/attendance/supervisor/daily');
    expect(client).toContain('/attendance/supervisor/history');
    expect(client).toContain('/attendance/supervisor/assignments/');
    expect(client).toContain('/detail');
    expect(adjustmentClient).toContain('/attendance/adjustment-requests');
    expect(adjustmentClient).not.toContain('/attendance/governance/assignments/');
    expect(adjustmentClient).not.toContain('/attendance/events');
  });

  it('keeps correction validation and approval sequencing explicit', () => {
    expect(page).toContain("manualDialog.workDate > today");
    expect(page).toContain("shiftDate(manualDialog.workDate, 1)");
    expect(page).toContain("if (new Date(checkOutAt) <= new Date(checkInAt))");
    expect(page).toContain("if (manualDialog.reason.trim().length < 5)");
    expect(page).toContain("if (reviewDialog.action !== 'approve' && reviewDialog.comment.trim().length < 3)");
    expect(page).toContain("if (admin) {");
    expect(page).toContain("await approveAttendanceAdjustment(token, requestId)");
    expect(page).toContain("setRequestStatus('PENDING_APPROVAL')");
  });

  it('keeps the responsive table state and mobile record contract explicit', () => {
    expect(page).toContain('loadingLabel="กำลังอ่านข้อมูล Attendance…"');
    expect(page).toContain('errorLabel={error ||');
    expect(page).toContain('<DataTableSkeletonRows');
    expect(page).toContain('<DataTableSkeletonCards');
    expect(page).toContain('<DataTableState variant="error"');
    expect(page).toContain('<DataTableState variant="empty"');
    expect(page).toContain('ariaLabel="การแบ่งหน้าประวัติ Attendance"');
    for (const field of ['Expected Site', 'Actual Site', 'Worked']) {
      expect(page).toContain(`<dt>${field}</dt>`);
    }
    expect(page).toContain('attendance-supervisor-v4__mobile-label">Flags');
    expect(css).toContain('overflow-wrap: anywhere;');
    expect(page).toContain('aria-label={`ลงเวลาแทน ${row.employeeName}`}');
    expect(page).toContain('aria-label={`ดูรายละเอียด Attendance ของ ${row.employeeName}`}');
  });
});
