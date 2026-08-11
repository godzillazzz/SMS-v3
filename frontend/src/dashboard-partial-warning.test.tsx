import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import type { DashboardFilters, DashboardSummary } from './components/dashboard/types';

const filters: DashboardFilters = { date: '2026-08-11', month: '2026-08', department: '' };
const summary = {
  totalEmployees: 10,
  activeEmployees: 9,
  workingToday: 7,
  onDutyToday: 7,
  leaveToday: 1,
  pendingLeaves: 0,
  monthShifts: 4,
  expiringLicenses: 0,
  pendingLicenseDocuments: 0,
  notScheduledToday: 2,
  context: { departments: [] },
  todayOperations: {},
  leaveOverview: {},
  licenseSummary: {},
  licenseOverview: {},
  actionRequired: [],
  expiringLicenseDetails: [],
  recentActivity: [],
  generatedAt: '2026-08-11T01:00:00.000Z'
} as DashboardSummary;

function renderDashboard(partialErrors: string[] = [], error?: string) {
  return renderToStaticMarkup(<DashboardPage
    summary={{ ...summary, partialErrors }}
    loading={false}
    error={error}
    user={{ role: 'ADMIN', displayName: 'UAT Admin' }}
    canManage
    filters={filters}
    onFiltersChange={() => undefined}
    onNavigate={() => undefined}
  />);
}

describe('Dashboard partial-data warning presentation contract', () => {
  it('does not show a warning for a healthy complete payload', () => {
    const markup = renderDashboard([]);
    expect(markup).not.toContain('dashboard-data-warning');
    expect(markup).not.toContain('ข้อมูลบางส่วนยังไม่พร้อม');
  });

  it('shows the warning only when partialErrors contains a real section failure', () => {
    const markup = renderDashboard(['licenseOverview']);
    expect(markup).toContain('dashboard-data-warning');
    expect(markup).toContain('ข้อมูลบางส่วนยังไม่พร้อม');
  });

  it('keeps the fatal error state separate from the partial-data warning', () => {
    const markup = renderDashboard(['licenseOverview'], 'dashboard request failed');
    expect(markup).not.toContain('dashboard-data-warning');
    expect(markup).toContain('dashboard-data-error');
  });
});
