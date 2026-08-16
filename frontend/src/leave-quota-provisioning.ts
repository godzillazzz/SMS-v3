export const LEAVE_QUOTA_DEFAULTS = Object.freeze({
  sickLeave: '30',
  personalLeave: '6',
  vacationLeave: '10'
});

export type QuotaEmployee = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  department?: string;
  isActive: boolean;
};

export type QuotaRow = {
  employeeId?: unknown;
  matchStatus?: unknown;
};

export type LeaveQuotaProvisioningValues = {
  employeeId?: string;
  sickLeave?: string;
  personalLeave?: string;
  vacationLeave?: string;
};

const entitlementFields = ['sickLeave', 'personalLeave', 'vacationLeave'] as const;

export function canProvisionLeaveQuota(role?: string) {
  return role === 'ADMIN';
}

export function quotaProvisioningEmployeeOptions(employees: QuotaEmployee[], quotas: QuotaRow[]) {
  const linkedEmployeeIds = new Set(
    quotas.map((quota) => String(quota.employeeId || '')).filter(Boolean)
  );
  return employees
    .filter((employee) => employee.isActive && !linkedEmployeeIds.has(employee.id))
    .map((employee) => ({
      value: employee.id,
      label: `${employee.employeeCode} · ${employee.firstName} ${employee.lastName} · ${employee.department || 'ไม่ระบุหน่วยงาน'}`
    }));
}

export function hasUnmatchedLegacyQuota(quotas: QuotaRow[]) {
  return quotas.some((quota) => ['UNMATCHED', 'DUPLICATE_UNMATCHED'].includes(String(quota.matchStatus || '')));
}

export function buildLeaveQuotaProvisioningPayload(values: LeaveQuotaProvisioningValues) {
  const employeeId = String(values.employeeId || '').trim();
  if (!employeeId) throw new Error('กรุณาเลือกพนักงาน');

  const payload: Record<string, string | number> = { employeeId };
  for (const field of entitlementFields) {
    const raw = String(values[field] ?? '').trim();
    if (!raw) throw new Error('กรุณาระบุสิทธิ์วันลาให้ครบ');
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 999) {
      throw new Error('สิทธิ์วันลาต้องเป็นตัวเลขตั้งแต่ 0 ถึง 999');
    }
    payload[field] = value;
  }
  return payload as { employeeId: string; sickLeave: number; personalLeave: number; vacationLeave: number };
}
