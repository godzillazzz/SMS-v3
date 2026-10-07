import { describe, expect, it } from 'vitest';
import { PAGE_PATHS, pageFromPath, pageTitle, SETTINGS_SECTIONS } from './routing';
import { ROLE_DISPLAY_LABEL, ROLE_MANAGEMENT_LABEL } from './role-display';
import fs from 'node:fs';
import path from 'node:path';

const read = (relative: string) => fs.readFileSync(path.join(__dirname, relative), 'utf8');

describe('T15 Thai user-facing language', () => {
  it('retires the remaining English headings and status copy from audited surfaces', () => {
    const audited = [
      read('pages/dashboard/DashboardPage.tsx'),
      read('components/dashboard/DashboardFilterBar.tsx'),
      read('components/dashboard/DataSyncStatusCard.tsx'),
      read('components/dashboard/LeaveSummaryCard.tsx'),
      read('components/dashboard/LicenseSummaryCard.tsx'),
      read('components/dashboard/MetricsGrid.tsx'),
      read('components/dashboard/RecentActivityCard.tsx'),
      read('components/dashboard/TodayOperationsCard.tsx'),
      read('components/dashboard/WorkQueueJourney.tsx'),
      read('components/dashboard/WorkforceOverviewCard.tsx'),
      read('main.tsx'),
      read('components/audit/AuditPageHeader.tsx'),
      read('components/audit/AuditTable.tsx'),
      read('pages/audit/AuditCompliancePage.tsx'),
      read('components/personnel/PersonnelDetailDrawer.tsx'),
      read('components/personnel/EmployeeGovernedEditModal.tsx'),
      read('components/personnel/EmployeeChangeReviewModal.tsx'),
      read('components/personnel/EmployeeLifecycleModal.tsx'),
      read('pages/access-management/RegistrationReviewPanel.tsx'),
      read('components/PersonnelMasterPanel.tsx'),
      read('components/LeavePolicySettingsCard.tsx')
    ].join('\n');

    for (const retired of [
      'Command Overview', 'OPEN APPROVAL CENTER', 'AUTHENTICATED', 'DATA CHANNEL DEGRADED',
      'PARTIAL DATA CHANNEL', 'LIVE FROM DASHBOARD API', 'Leave Management',
      'Configuration Center สำหรับ', '<h1>Shift Setup</h1>', '<h1>Rule Checking</h1>',
      'Security Incident Logs &amp; Audit Trail', 'Employee 360', 'Future-effective',
      'Change History Timeline', 'Department / Position Master', 'Approval Authority aliases',
      'Employee Master', 'ข้อมูล Employee Master', 'Employee ID', 'Before → After',
      'Department Master', 'Position Master', 'Audit Log', 'Approval policy',
      'Shift code', '<small>Core</small>', 'Active</option>', 'Inactive</option>',
      'TODAY / RECOMMENDED FLOW', 'SYSTEM & DATA STATUS', 'LEAVE & QUOTA',
      'LICENSE STATUS', 'RECENT ACTIVITY', "Today's Operations", 'WORKFORCE OVERVIEW',
      'Personnel / Roster', 'active แต่ไม่พบกะ', 'session และ token maintenance', 'current status'
    ]) expect(audited).not.toContain(retired);
  });

  it('uses Thai labels for every route, settings section, and displayed role', () => {
    const thai = /[\u0E00-\u0E7F]/;
    for (const page of Object.keys(PAGE_PATHS) as Array<keyof typeof PAGE_PATHS>) {
      expect(pageFromPath(PAGE_PATHS[page])).toBe(page);
      expect(pageTitle(page)).toMatch(thai);
    }
    for (const section of SETTINGS_SECTIONS) expect(section.label).toMatch(thai);
    for (const label of Object.values(ROLE_DISPLAY_LABEL)) expect(label).toMatch(thai);
    for (const label of Object.values(ROLE_MANAGEMENT_LABEL)) expect(label).toMatch(thai);
    expect(read('pages/dashboard/DashboardPage.tsx')).toContain('<h1>ภาพรวมระบบ</h1>');
  });

  it('keeps role and internal rule codes separate from their Thai presentation labels', () => {
    const roleDisplay = read('role-display.ts');
    expect(roleDisplay).toContain('ADMIN:');
    expect(roleDisplay).toContain('MANAGER:');
    expect(roleDisplay).toContain('SUPERVISOR:');
    expect(roleDisplay).toContain('VIEWER:');
    expect(read('pages/dashboard/DashboardPage.tsx')).toContain("user?.role === 'ADMIN'");
    expect(read('components/PersonnelMasterPanel.tsx')).toContain("kind === 'department'");
  });
});
