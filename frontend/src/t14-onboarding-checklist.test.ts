import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (relative: string) => fs.readFileSync(path.join(__dirname, relative), 'utf8');
const drawer = read('components/personnel/PersonnelDetailDrawer.tsx');
const page = read('pages/personnel/PersonnelDirectoryPage.tsx');
const css = read('styles/personnel-directory.css');
const attendancePage = read('pages/attendance-simple/AttendanceSimplePage.tsx');
const app = read('main.tsx');

describe('T14 onboarding checklist', () => {
  it('shows the requested employee domains from their existing server authorities', () => {
    for (const label of ['บัญชีผู้ใช้เชื่อมโยง', 'ใบอนุญาตที่ยังใช้งาน', 'โควตาวันลา', 'ตารางกะที่อนุมัติ', 'จุดรักษาความปลอดภัย', 'อุปกรณ์ลงเวลาตามสัญญาระบบ']) {
      expect(drawer).toContain(label);
    }
    expect(drawer).toContain('api.employeeOnboardingReadiness');
    expect(drawer).toContain('getEmployeeLicenses(token, employee.id)');
    expect(drawer).toContain('getEmployeeLeaveQuota(token, quotaYear, employee.id)');
    expect(drawer).toContain('Promise.allSettled');
  });

  it('does not expose the readiness aggregate or photo requirement as an Attendance prerequisite', () => {
    const start = drawer.indexOf('<section id="employee-360-readiness"');
    const end = drawer.indexOf('<section id="employee-360-history"', start);
    const checklist = drawer.slice(start, end);
    expect(checklist).not.toContain('Reference Photo');
    expect(checklist).not.toContain('onboardingReadiness.status');
    expect(checklist).not.toContain('onboardingReadiness?.blockers');
    expect(checklist).toContain('ไม่คำนวณผลรวม');
  });

  it('routes managers to the matching employee and hides privileged destinations by role', () => {
    expect(drawer).toContain('employeeQuery');
    expect(drawer).toContain("role === 'ADMIN' ? `/app/users?");
    expect(drawer).toContain('`/app/licenses?${employeeQuery}`');
    expect(drawer).toContain('`/app/leave/quotas?${employeeQuery}&year=${quotaYear}`');
    expect(drawer).toContain('`/app/roster?${employeeQuery}`');
    expect(page).toContain('role={role}');
    expect(css).toContain('.personnel-onboarding-list');
    expect(css).toContain('.personnel-onboarding-item>a:focus-visible');
  });

  it('keeps employee time-clock remediation limited to self-service actions', () => {
    expect(attendancePage).toContain("? { message: message || 'บัญชีนี้ยังไม่พร้อมสำหรับการลงเวลา กรุณาติดต่อผู้ดูแลระบบ' }");
    expect(attendancePage).toContain("actionLabel: requestErrorCode === 'ATTENDANCE_DEVICE_REQUIRED' ? 'ลงทะเบียนอุปกรณ์นี้' : 'เปิดสถานะอุปกรณ์ลงเวลา', action: onOpenAttendanceDevice");
    expect(attendancePage).toContain("actionLabel: onOpenSupervisor ? 'เปิดหน้าติดตามการลงเวลา' : undefined, action: onOpenSupervisor");
    expect(app).toContain("onOpenSupervisor={pwaShell && ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(auth.user?.role || '') && !auth.isViewingAs ? openPwaAttendanceSupervisor : undefined}");
  });
});
