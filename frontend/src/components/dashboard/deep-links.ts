import type { DashboardFilters } from './types';

export type DashboardDetailMetric =
  | 'activeEmployees' | 'totalEmployees' | 'schedule' | 'leaveToday' | 'pendingLeaves'
  | 'leaveMonth' | 'leaveMonthStatus' | 'licenseStatus' | 'licenseExpiry'
  | 'pendingUsers' | 'unmatchedQuota';

export type DashboardDetailQuery = Record<string, string | undefined>;

export function dashboardDetailQuery(
  metric: DashboardDetailMetric,
  filters: DashboardFilters,
  role: string | undefined,
  selector: DashboardDetailQuery = {}
): DashboardDetailQuery {
  return {
    metric,
    date: filters.date,
    month: filters.month,
    ...(role === 'ADMIN' && filters.department.trim() ? { department: filters.department.trim() } : {}),
    page: '1',
    pageSize: '20',
    ...selector
  };
}
