export const APPROVAL_COUNT_TYPES = [
  'EMPLOYEE_MASTER_CHANGE',
  'EMPLOYEE_REFERENCE_PHOTO',
  'LICENSE_DOCUMENT',
  'SCHEDULE_APPROVAL',
  'ATTENDANCE_DEVICE_REQUEST',
  'ATTENDANCE_ADJUSTMENT_REQUEST',
  'REGISTRATION_REQUEST',
  'USER_ACCESS',
  'LEAVE_REQUEST'
] as const;

export type ApprovalCountType = typeof APPROVAL_COUNT_TYPES[number];
export type ApprovalCountSummary = {
  total: number;
  byType: Record<ApprovalCountType, number>;
};

const APPROVAL_MENU_TYPES: Readonly<Record<string, readonly ApprovalCountType[]>> = Object.freeze({
  employees: ['EMPLOYEE_MASTER_CHANGE', 'EMPLOYEE_REFERENCE_PHOTO'],
  licenses: ['LICENSE_DOCUMENT'],
  approvals: ['SCHEDULE_APPROVAL'],
  attendanceDevice: ['ATTENDANCE_DEVICE_REQUEST'],
  attendanceSupervisor: ['ATTENDANCE_ADJUSTMENT_REQUEST'],
  users: ['REGISTRATION_REQUEST', 'USER_ACCESS'],
  leavePending: ['LEAVE_REQUEST']
});

export function approvalCountValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

export function approvalMenuCount(menuId: string, summary: ApprovalCountSummary | null | undefined): number | null {
  if (!summary) return null;
  if (menuId === 'approvalCenter') return summary.total;
  const types = APPROVAL_MENU_TYPES[menuId];
  if (!types) return null;
  return types.reduce((total, type) => total + summary.byType[type], 0);
}

export function approvalBadgeText(count: number | null | undefined): string | undefined {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return undefined;
  return count > 99 ? '99+' : String(count);
}

export function approvalNotificationLabel(count: number | null | undefined): string {
  return typeof count === 'number' && Number.isFinite(count)
    ? `คำขออนุมัติ ${count} รายการ`
    : 'เปิดศูนย์อนุมัติ';
}
