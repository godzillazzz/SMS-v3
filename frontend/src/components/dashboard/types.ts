export type DashboardSummary = Record<string, unknown>;

export type DashboardUser = {
  displayName?: string;
  role?: string;
};

export type DashboardNavigate = (page: 'employees' | 'licenses' | 'schedule' | 'leave' | 'leavePending' | 'users' | 'rules') => void;

export const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const formatMetric = (value: number) => new Intl.NumberFormat('th-TH').format(value);
