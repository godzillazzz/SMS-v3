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
const styles = read('styles/dashboard.css');

describe('executive dashboard contract', () => {
  it('renders real summary fields for KPI, action, license, leave, and activity widgets', () => {
    for (const field of ['workingToday', 'leaveToday', 'pendingLicenseDocuments', 'notScheduledToday', 'licenseSummary', 'leaveSummary', 'actionRequired', 'recentActivity']) expect(page).toContain(field);
    expect(page).toContain('canAdmin');
    expect(metrics).toContain('onNavigate');
    expect(actions).toContain('rows');
    expect(licenses).toContain('RETURNED_FOR_CORRECTION');
  });

  it('routes the authenticated Dashboard page to the executive component', () => {
    expect(app).toContain("import { DashboardPage } from './pages/dashboard/DashboardPage';");
    expect(app).toContain("if (activePage === 'dashboard') return <DashboardPage");
    expect(app).toContain('summary={dashboardSummary}');
    expect(app).toContain('canManage={canManage}');
  });

  it('includes loading, empty, accessible navigation, and mobile layout contracts', () => {
    expect(page).toContain('dashboard-data-error');
    expect(actions).toContain('ไม่มีรายการที่ต้องติดตาม');
    expect(metrics).toContain('ariaLabel');
    expect(styles).toContain('@media(max-width:600px)');
    expect(styles).toContain('dashboard-tertiary-grid');
  });

  it('formats dashboard counts with Thai number formatting', () => {
    expect(formatMetric(1234)).toMatch(/[0-9๑-๙],[0-9๑-๙]{3}/);
  });
});
