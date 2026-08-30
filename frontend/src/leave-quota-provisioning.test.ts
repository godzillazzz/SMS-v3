import { describe, expect, it } from 'vitest';
import {
  LEAVE_QUOTA_DEFAULTS,
  buildLeaveQuotaProvisioningPayload,
  canProvisionLeaveQuota,
  currentBangkokQuotaYear,
  hasUnmatchedLegacyQuota,
  leaveQuotaDefaultsFromPolicy,
  quotaProvisioningEmployeeOptions,
  thaiQuotaYearLabel
} from './leave-quota-provisioning';

describe('G03.1 annual leave quota UI contract', () => {
  it('keeps provisioning Admin-only and uses the 30/3/6 annual baseline', () => {
    expect(canProvisionLeaveQuota('ADMIN')).toBe(true);
    expect(canProvisionLeaveQuota('MANAGER')).toBe(false);
    expect(canProvisionLeaveQuota('VIEWER')).toBe(false);
    expect(LEAVE_QUOTA_DEFAULTS).toEqual({ sickLeave: '30', personalLeave: '3', vacationLeave: '6' });
  });

  it('derives governed quota defaults from resolved Leave Policy with safe fallback', () => {
    expect(leaveQuotaDefaultsFromPolicy({ defaultSickDays: 31, defaultPersonalDays: 4, defaultVacationDays: 7 })).toEqual({ sickLeave: '31', personalLeave: '4', vacationLeave: '7' });
    expect(leaveQuotaDefaultsFromPolicy({ defaultSickDays: -1, defaultPersonalDays: 'bad', defaultVacationDays: 1000 })).toEqual(LEAVE_QUOTA_DEFAULTS);
  });

  it('derives the Gregorian business year in Bangkok and displays Buddhist year', () => {
    expect(currentBangkokQuotaYear(new Date('2026-12-31T16:59:59Z'))).toBe(2026);
    expect(currentBangkokQuotaYear(new Date('2026-12-31T17:00:00Z'))).toBe(2027);
    expect(thaiQuotaYearLabel(2027)).toBe('พ.ศ. 2570');
  });

  it('excludes only selected-year authorities and ambiguous linked legacy employees', () => {
    const employees = [
      { id: 'employee-1', employeeCode: 'E001', firstName: 'One', lastName: 'Available', department: 'Security', isActive: true },
      { id: 'employee-2', employeeCode: 'E002', firstName: 'Two', lastName: 'SameYear', department: 'North', isActive: true },
      { id: 'employee-3', employeeCode: 'E003', firstName: 'Three', lastName: 'OtherYear', department: 'South', isActive: true },
      { id: 'employee-4', employeeCode: 'E004', firstName: 'Four', lastName: 'Legacy', department: 'South', isActive: true }
    ];
    const quotas = [
      { employeeId: 'employee-2', quotaYear: 2027, matchStatus: 'MATCHED' },
      { employeeId: 'employee-3', quotaYear: 2026, matchStatus: 'MATCHED' },
      { employeeId: 'employee-4', quotaYear: null, matchStatus: 'MATCHED' }
    ];
    expect(quotaProvisioningEmployeeOptions(employees, quotas, 2027).map((item) => item.value)).toEqual(['employee-1', 'employee-3']);
  });

  it('recognizes null-year legacy data as requiring classification', () => {
    expect(hasUnmatchedLegacyQuota([{ quotaYear: 2027, matchStatus: 'MATCHED' }])).toBe(false);
    expect(hasUnmatchedLegacyQuota([{ quotaYear: null, matchStatus: 'MATCHED' }])).toBe(true);
    expect(hasUnmatchedLegacyQuota([{ quotaYear: null, matchStatus: 'UNMATCHED' }])).toBe(true);
  });

  it('builds an explicit Gregorian employee/year payload and accepts decimal overrides', () => {
    expect(buildLeaveQuotaProvisioningPayload({ employeeId: 'employee-1', quotaYear: 2027, sickLeave: '30', personalLeave: '3', vacationLeave: '10.5' })).toEqual({ employeeId: 'employee-1', quotaYear: 2027, sickLeave: 30, personalLeave: 3, vacationLeave: 10.5 });
  });

  it('rejects missing or invalid annual year and invalid entitlement values', () => {
    expect(() => buildLeaveQuotaProvisioningPayload({ employeeId: 'employee-1', sickLeave: '30', personalLeave: '3', vacationLeave: '6' })).toThrow('ปีโควตาไม่ถูกต้อง');
    expect(() => buildLeaveQuotaProvisioningPayload({ employeeId: 'employee-1', quotaYear: 2570, sickLeave: '30', personalLeave: '3', vacationLeave: '6' })).toThrow('ปีโควตาไม่ถูกต้อง');
    expect(() => buildLeaveQuotaProvisioningPayload({ employeeId: 'employee-1', quotaYear: 2027, sickLeave: '-1', personalLeave: '3', vacationLeave: '6' })).toThrow('0 ถึง 999');
  });
});
