import { describe, expect, it } from 'vitest';
import { dashboardDetailQuery } from './deep-links';

describe('Dashboard detail URL contract', () => {
  const filters = { date: '2026-10-10', month: '2026-10', department: 'AN1' };

  it('preserves the selected dashboard context and selector for administrators', () => {
    expect(dashboardDetailQuery('licenseExpiry', filters, 'ADMIN', { expiryBucket: 'EXPIRING_0_30' })).toEqual({
      metric: 'licenseExpiry', date: '2026-10-10', month: '2026-10', department: 'AN1',
      page: '1', pageSize: '20', expiryBucket: 'EXPIRING_0_30'
    });
  });

  it('does not treat a URL department as viewer scope', () => {
    expect(dashboardDetailQuery('leaveToday', filters, 'VIEWER')).toEqual({
      metric: 'leaveToday', date: '2026-10-10', month: '2026-10',
      page: '1', pageSize: '20'
    });
  });

  it('retains selected context while opening one shift group', () => {
    expect(dashboardDetailQuery('schedule', filters, 'SUPERVISOR', { workforce: 'SCHEDULED', shiftTypeCode: 'A1' })).toMatchObject({
      metric: 'schedule', date: '2026-10-10', month: '2026-10',
      workforce: 'SCHEDULED', shiftTypeCode: 'A1'
    });
  });
});
