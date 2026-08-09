export type DashboardPage = 'employees' | 'licenses' | 'schedule' | 'leave' | 'leavePending' | 'leaveHistory' | 'quota' | 'users' | 'rules';

export type DashboardFilters = { date: string; month: string; department: string };

export type DashboardSummary = Record<string, unknown>;

export type DashboardAction = { key: string; title: string; count: number; severity: 'urgent' | 'warning' | 'follow-up'; page: DashboardPage };
export type DashboardActivity = { id: string; action: string; entityType: string; createdAt: string; actor?: { displayName?: string; role?: string } | null };
export type DashboardExpiringLicense = { employeeId: string; employeeCode?: string | null; employeeName: string; licenseId: string; expiryDate: string; daysRemaining: number; urgency: 'expired' | 'urgent' | 'warning' };

export type DashboardUser = {
  displayName?: string;
  role?: string;
  department?: string;
};

export type DashboardNavigate = (page: DashboardPage) => void;

export const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const formatMetric = (value: number) => new Intl.NumberFormat('th-TH').format(value);
