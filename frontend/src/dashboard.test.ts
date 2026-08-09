import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { formatMetric } from './components/dashboard/types';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const page = read('pages/dashboard/DashboardPage.tsx');
const app = read('main.tsx');
const metrics = read('components/dashboard/MetricsGrid.tsx');
const actions = read('components/dashboard/AttentionNeededCard.tsx');
const licenses = read('components/dashboard/LicenseSummaryCard.tsx');
const filters = read('components/dashboard/DashboardFilterBar.tsx');
const today = read('components/dashboard/TodayOperationsCard.tsx');
const recent = read('components/dashboard/RecentActivityCard.tsx');
const styles = read('styles/dashboard.css');

describe('executive dashboard contract', () => {
  it('renders real summary fields for KPI, action, license, leave, and activity widgets', () => {
    for (const field of ['workingToday', 'leaveToday', 'pendingLicenseDocuments', 'notScheduledToday', 'licenseSummary', 'leaveSummary', 'leaveOverview', 'licenseOverview', 'todayOperations', 'actionRequired', 'recentActivity', 'expiringLicenseDetails']) expect(page).toContain(field);
    expect(page).toContain('canAdmin');
    expect(metrics).toContain('onNavigate');
    for (const label of ['กำลังปฏิบัติงาน', 'ลาวันนี้', 'รออนุมัติ', 'ต้องติดตาม']) expect(metrics).toContain(label);
    expect(metrics).toContain('dashboard-secondary-metrics');
    expect(page).toContain('pendingLeaves');
    expect(page).toContain('dashboard-command-grid');
    expect(actions).toContain('rows');
    expect(actions).toContain('ดูทั้งหมด');
    expect(actions).toContain('หมดอายุแล้ว');
    expect(actions).toContain('dashboard-expiring-row');
    expect(licenses).toContain('RETURNED_FOR_CORRECTION');
    expect(filters).toContain('type="date"');
    expect(filters).toContain('type="month"');
    expect(today).toContain('byShift');
    expect(today).toContain('dashboard-today-highlight');
  });

  it('routes the authenticated Dashboard page to the executive component', () => {
    expect(app).toContain("import { DashboardPage } from './pages/dashboard/DashboardPage';");
    expect(app).toContain("if (activePage === 'dashboard') return <DashboardPage");
    expect(app).toContain('summary={dashboardSummary}');
    expect(app).toContain('canManage={canManage}');
  });

  it('includes loading, empty, accessible navigation, and mobile layout contracts', () => {
    expect(page).toContain('dashboard-data-error');
    expect(page).toContain('dashboard-data-warning');
    expect(actions).toContain('ไม่มีรายการที่ต้องติดตาม');
    expect(metrics).toContain('ariaLabel');
    expect(styles).toContain('@media(max-width:600px)');
    expect(styles).toContain('dashboard-tertiary-grid');
    expect(styles).toContain('dashboard-filter-bar');
    expect(styles).toContain('dashboard-today-stats');
    expect(styles).toContain('dashboard-kpi-section');
    expect(styles).toContain('dashboard-secondary-metrics');
  });

  it('formats dashboard counts with Thai number formatting', () => {
    expect(formatMetric(1234)).toMatch(/[0-9๑-๙],[0-9๑-๙]{3}/);
  });

  it('keeps expiring license records actionable without exposing file URLs', () => {
    expect(actions).toContain('employeeName');
    expect(actions).toContain('expiryDate');
    expect(actions).toContain('daysRemaining');
    expect(actions).toContain('urgency');
    expect(actions).toContain("onNavigate('licenses')");
    expect(actions).not.toContain('signedUrl');
  });

  it('filters routine session activity while keeping business events visible', () => {
    expect(recent).toContain('TOKEN_REUSE');
    expect(recent).toContain('REFRESHSESSION');
    expect(recent).toContain('isTechnicalActivity');
    expect(recent).toContain('meaningfulActivities');
    expect(recent).toContain('LICENSE_APPROVED');
  });
});
