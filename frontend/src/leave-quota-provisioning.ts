export const LEAVE_QUOTA_DEFAULTS = Object.freeze({
  sickLeave: '30',
  personalLeave: '3',
  vacationLeave: '6'
});

export function leaveQuotaDefaultsFromPolicy(policy: Record<string, unknown> = {}) {
  const safe = (value: unknown, fallback: string) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 999 ? String(number) : fallback;
  };
  return Object.freeze({
    sickLeave: safe(policy.defaultSickDays, LEAVE_QUOTA_DEFAULTS.sickLeave),
    personalLeave: safe(policy.defaultPersonalDays, LEAVE_QUOTA_DEFAULTS.personalLeave),
    vacationLeave: safe(policy.defaultVacationDays, LEAVE_QUOTA_DEFAULTS.vacationLeave)
  });
}

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
  quotaYear?: unknown;
  matchStatus?: unknown;
};

export type LeaveQuotaProvisioningValues = {
  employeeId?: string;
  quotaYear?: string | number;
  sickLeave?: string;
  personalLeave?: string;
  vacationLeave?: string;
};

const entitlementFields = ['sickLeave', 'personalLeave', 'vacationLeave'] as const;

export function canProvisionLeaveQuota(role?: string) {
  return role === 'ADMIN';
}

export function currentBangkokQuotaYear(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric' }).formatToParts(date);
  return Number(parts.find((part) => part.type === 'year')?.value || date.getUTCFullYear());
}

export function thaiQuotaYearLabel(year: number) {
  return `พ.ศ. ${year + 543}`;
}

export function quotaProvisioningEmployeeOptions(employees: QuotaEmployee[], quotas: QuotaRow[], selectedYear: number) {
  const annualEmployeeIds = new Set(
    quotas
      .filter((quota) => Number(quota.quotaYear) === selectedYear)
      .map((quota) => String(quota.employeeId || ''))
      .filter(Boolean)
  );
  const ambiguousLegacyEmployeeIds = new Set(
    quotas
      .filter((quota) => quota.quotaYear === null || quota.quotaYear === undefined || quota.quotaYear === '')
      .map((quota) => String(quota.employeeId || ''))
      .filter(Boolean)
  );
  return employees
    .filter((employee) => employee.isActive && !annualEmployeeIds.has(employee.id) && !ambiguousLegacyEmployeeIds.has(employee.id))
    .map((employee) => ({
      value: employee.id,
      label: `${employee.employeeCode} · ${employee.firstName} ${employee.lastName} · ${employee.department || 'ไม่ระบุหน่วยงาน'}`
    }));
}

export function hasUnmatchedLegacyQuota(quotas: QuotaRow[]) {
  return quotas.some((quota) => quota.quotaYear === null || quota.quotaYear === undefined || ['UNMATCHED', 'DUPLICATE_UNMATCHED'].includes(String(quota.matchStatus || '')));
}

export function buildLeaveQuotaProvisioningPayload(values: LeaveQuotaProvisioningValues) {
  const employeeId = String(values.employeeId || '').trim();
  if (!employeeId) throw new Error('กรุณาเลือกพนักงาน');
  const quotaYear = Number(values.quotaYear);
  if (!Number.isInteger(quotaYear) || quotaYear < 2000 || quotaYear > 2200) throw new Error('ปีโควตาไม่ถูกต้อง');

  const payload: Record<string, string | number> = { employeeId, quotaYear };
  for (const field of entitlementFields) {
    const raw = String(values[field] ?? '').trim();
    if (!raw) throw new Error('กรุณาระบุสิทธิ์วันลาให้ครบ');
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 999) {
      throw new Error('สิทธิ์วันลาต้องเป็นตัวเลขตั้งแต่ 0 ถึง 999');
    }
    payload[field] = value;
  }
  return payload as { employeeId: string; quotaYear: number; sickLeave: number; personalLeave: number; vacationLeave: number };
}
