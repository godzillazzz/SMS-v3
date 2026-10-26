import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('./main.tsx');
const personnelPage = read('./pages/personnel/PersonnelDirectoryPage.tsx');
const personnelTable = read('./components/personnel/PersonnelTable.tsx');
const personnelStyles = read('./styles/personnel-directory.css');
const operationalStyles = read('./styles/operational-layer.css');
const api = read('./api.ts');
const operationsRoutes = read('../../src/routes/operations.routes.js');
const employeesRoutes = read('../../src/routes/employees.routes.js');
const attendanceRoutes = read('../../src/routes/attendance.routes.js');
const attendanceService = read('../../src/services/attendance-simple.service.js');
const siteEvidence = read('../../src/services/attendance-site-evidence.service.js');
const verificationContext = read('../../src/services/attendance-verification-context.service.js');

describe('DOCX readiness and schedule rule UI removal', () => {
  it('does not render or import the schedule rule-check panel', () => {
    expect(main).not.toContain('ScheduleRuleChecksPanel');
    expect(main).not.toContain('ruleFocusDate');
    expect(main).not.toContain('schedule-rule-panel');
    expect(main).not.toContain('rule-focus-col');
  });

  it('removes personnel readiness panel, status column, and mobile status presentation', () => {
    expect(personnelPage).not.toContain('AttendanceReadinessCenter');
    expect(personnelPage).not.toContain('canViewReadiness');
    expect(personnelPage).not.toContain('readinessSnapshot');
    expect(personnelPage).not.toContain('readinessByEmployeeId');
    expect(personnelTable).not.toContain('canViewReadiness');
    expect(personnelTable).not.toContain('readinessByEmployeeId');
    expect(personnelTable).not.toContain('data-readiness-status');
    expect(personnelTable).not.toContain('ความพร้อม');
    expect(personnelStyles).not.toContain('attendance-readiness-center');
    expect(personnelStyles).not.toContain('personnel-mobile-readiness');
    expect(operationalStyles).not.toContain('attendance-readiness-center');
  });

  it('keeps readiness and rule-check APIs and server routes available', () => {
    expect(api).toContain('employeeReadinessCenter:');
    expect(api).toContain('/employees/readiness/center');
    expect(employeesRoutes).toContain('/readiness/center');
    expect(api).toContain('ruleChecks:');
    expect(api).toContain('/rule-checks?month=');
    expect(operationsRoutes).toContain("router.get('/rule-checks'");
    expect(main).toContain("if (!auth.token || activePage !== 'rules') return;");
    expect(main).toContain('api.ruleChecks(auth.token, scheduleMonth)');
  });

  it('keeps schedule editing and approval behavior in the roster', () => {
    expect(main).toContain('setScheduleDrafts');
    expect(main).toContain('บันทึกการแก้ตารางที่อนุมัติแล้ว');
    expect(main).toContain('api.updateScheduleApproval(auth.token');
    expect(main).toContain('api.approveScheduleMonth(auth.token, scheduleMonth)');
  });

  it('leaves server-side attendance geofence, selfie, and event gates intact', () => {
    expect(attendanceRoutes).toContain("router.post('/simple/events'");
    expect(attendanceRoutes).toContain('simpleAttendance.submit');
    expect(attendanceService).toContain('selfiePolicies.resolve');
    expect(attendanceService).toContain('ATTENDANCE_SELFIE_REQUIRED');
    expect(attendanceService).toContain('ATTENDANCE_SELFIE_CAMERA_REQUIRED');
    expect(verificationContext).toContain('siteEvidence.validateForAssignment');
    expect(siteEvidence).toContain('ATTENDANCE_OUTSIDE_SITE_GEOFENCE');
    expect(siteEvidence).toContain('validateForAssignment');
  });
});
