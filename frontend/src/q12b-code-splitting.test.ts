import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.tsx');
const attendancePolicyContract = read('components/attendance-policy-contract.ts');
const leavePolicyContract = read('components/leave-policy-contract.ts');

describe('Q12-B route-level code splitting contracts', () => {
  it('keeps the default Dashboard eager while lazy-loading non-default heavy routes', () => {
    expect(main).toContain("import { DashboardPage } from './pages/dashboard/DashboardPage';");
    const lazyModules = [
      ['AttendancePage', './pages/attendance/AttendancePage'],
      ['AttendanceSupervisorPage', './pages/attendance-supervisor/AttendanceSupervisorPage'],
      ['SecuritySiteManagementPanel', './components/SecuritySiteManagementPanel'],
      ['ReportCenterPage', './pages/reports/ReportCenterPage'],
      ['AccessManagementPage', './pages/access-management/AccessManagementPage'],
      ['PersonnelDirectoryPage', './pages/personnel/PersonnelDirectoryPage'],
      ['SystemHealthPage', './pages/system-health/SystemHealthPage'],
      ['DataQualityCenterPage', './pages/data-quality/DataQualityCenterPage']
    ] as const;
    for (const [componentName, modulePath] of lazyModules) {
      expect(main).toContain(`const ${componentName} = React.lazy(() => import('${modulePath}')`);
      expect(main).not.toContain(`import { ${componentName} } from '${modulePath}';`);
    }
  });

  it('keeps lazy route rendering behind a user-visible Suspense fallback', () => {
    expect(main).toContain('<React.Suspense fallback={<div className="full-loader" role="status">กำลังโหลดหน้า…</div>}>{content()}</React.Suspense>');
  });

  it('keeps lazy overlay modules behind their own Suspense boundary', () => {
    for (const marker of ['<EmployeeGovernedEditModal', '<EmployeeChangeReviewModal', '<PasskeySecurityPanel']) {
      expect(main).toContain(marker);
    }
    expect(main.match(/กำลังโหลดหน้าต่าง…/g)?.length).toBe(3);
  });

  it('splits configuration-only panels without changing their governed mounts', () => {
    for (const name of [
      'AttendancePolicySettingsCard',
      'LeavePolicySettingsCard',
      'LeaveTypeMasterPanel',
      'AutoSchedulePatternPanel',
      'ApprovalAuthorityMatrixPanel',
      'PersonnelMasterPanel',
      'DataRetentionCenterPanel',
      'ConfigurationRegistryPanel',
      'NotificationCenterPanel'
    ]) {
      expect(main).toContain(`const ${name} = React.lazy(() => import(`);
    }
    expect(main).toContain('<ApprovalAuthorityMatrixPanel token={token} />');
    expect(main).toContain('<DataRetentionCenterPanel token={token} />');
    expect(main).toContain('<PersonnelMasterPanel token={token} />');
  });

  it('keeps policy keys/defaults in lightweight contracts so policy UI chunks can split effectively', () => {
    expect(main).toContain("from './components/attendance-policy-contract';");
    expect(main).toContain("from './components/leave-policy-contract';");
    expect(main).not.toContain("from './components/AttendancePolicySettingsCard';");
    expect(main).not.toContain("from './components/LeavePolicySettingsCard';");
    for (const marker of [
      'ATTENDANCE_QR_POLICY',
      'ATTENDANCE_GPS_MAX_ACCURACY_METERS',
      'ATTENDANCE_QR_STEP_UP_ON_SITE_OVERLAP'
    ]) expect(attendancePolicyContract).toContain(marker);
    for (const marker of [
      'LEAVE_DEFAULT_SICK_DAYS',
      'LEAVE_DEFAULT_PERSONAL_DAYS',
      'LEAVE_DEFAULT_VACATION_DAYS',
      'LEAVE_MANAGER_RETROACTIVE_MAX_DAYS_BACK'
    ]) expect(leavePolicyContract).toContain(marker);
  });

  it('lazy-loads Rules data surfaces while preserving domain action wiring in the app shell', () => {
    expect(main).toContain("const RuleCheckingDataSurfaces = React.lazy(() => import('./components/RuleCheckingDataSurfaces')");
    expect(main).toContain('<RuleCheckingDataSurfaces rules={rules} results={results} violations={violations}');
    expect(main).toContain('handleOperationAction(row, action)');
  });
});
