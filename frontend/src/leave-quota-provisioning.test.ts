import { describe, expect, it } from 'vitest';
import {
  LEAVE_QUOTA_DEFAULTS,
  buildLeaveQuotaProvisioningPayload,
  canProvisionLeaveQuota,
  hasUnmatchedLegacyQuota,
  quotaProvisioningEmployeeOptions
} from './leave-quota-provisioning';

describe('Leave quota provisioning UI contract', () => {
  it('shows provisioning only to Admin and keeps the approved defaults', () => {
    expect(canProvisionLeaveQuota('ADMIN')).toBe(true);
    expect(canProvisionLeaveQuota('MANAGER')).toBe(false);
    expect(canProvisionLeaveQuota('VIEWER')).toBe(false);
    expect(LEAVE_QUOTA_DEFAULTS).toEqual({ sickLeave: '30', personalLeave: '6', vacationLeave: '10' });
  });

  it('filters inactive and already-linked employees and shows code, name, and department', () => {
    const options = quotaProvisioningEmployeeOptions([
      { id: 'employee-1', employeeCode: 'E001', firstName: 'One', lastName: 'Active', department: 'Security', isActive: true },
      { id: 'employee-2', employeeCode: 'E002', firstName: 'Two', lastName: 'Linked', department: 'North', isActive: true },
      { id: 'employee-3', employeeCode: 'E003', firstName: 'Three', lastName: 'Inactive', department: 'South', isActive: false }
    ], [{ employeeId: 'employee-2', matchStatus: 'MATCHED' }]);
    expect(options).toEqual([{ value: 'employee-1', label: 'E001 · One Active · Security' }]);
  });

  it('detects only legacy unmatched states for the provisioning warning', () => {
    expect(hasUnmatchedLegacyQuota([{ matchStatus: 'MATCHED' }])).toBe(false);
    expect(hasUnmatchedLegacyQuota([{ matchStatus: 'UNMATCHED' }])).toBe(true);
    expect(hasUnmatchedLegacyQuota([{ matchStatus: 'DUPLICATE_UNMATCHED' }])).toBe(true);
    expect(hasUnmatchedLegacyQuota([{ matchStatus: 'DUPLICATE_MATCHED' }])).toBe(false);
  });

  it('accepts zero and decimal values within range', () => {
    expect(buildLeaveQuotaProvisioningPayload({ employeeId: 'employee-1', sickLeave: '0', personalLeave: '4.5', vacationLeave: '999' })).toEqual({ employeeId: 'employee-1', sickLeave: 0, personalLeave: 4.5, vacationLeave: 999 });
  });

  it('rejects missing, negative, non-numeric, and greater-than-999 values', () => {
    expect(() => buildLeaveQuotaProvisioningPayload({ employeeId: '', sickLeave: '30', personalLeave: '6', vacationLeave: '10' })).toThrow('กรุณาเลือกพนักงาน');
    expect(() => buildLeaveQuotaProvisioningPayload({ employeeId: 'employee-1', sickLeave: '', personalLeave: '6', vacationLeave: '10' })).toThrow('กรุณาระบุสิทธิ์วันลาให้ครบ');
    expect(() => buildLeaveQuotaProvisioningPayload({ employeeId: 'employee-1', sickLeave: '-1', personalLeave: '6', vacationLeave: '10' })).toThrow('0 ถึง 999');
    expect(() => buildLeaveQuotaProvisioningPayload({ employeeId: 'employee-1', sickLeave: 'abc', personalLeave: '6', vacationLeave: '10' })).toThrow('0 ถึง 999');
    expect(() => buildLeaveQuotaProvisioningPayload({ employeeId: 'employee-1', sickLeave: '1000', personalLeave: '6', vacationLeave: '10' })).toThrow('0 ถึง 999');
  });
});
