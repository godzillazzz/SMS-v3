// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AttentionNeededCard } from './AttentionNeededCard';

afterEach(() => cleanup());

describe('AttentionNeededCard dashboard deep links', () => {
  it.each([
    ['pendingLeaves', 'คำขอลารออนุมัติ', { metric: 'pendingLeaves' }],
    ['pendingUsers', 'บัญชีผู้ใช้รอตรวจสอบ', { metric: 'pendingUsers' }],
    ['licensePending', 'ใบอนุญาตรอตรวจสอบ', { metric: 'licenseStatus', status: 'PENDING' }],
    ['unmatchedQuota', 'โควต้าที่ยังไม่จับคู่', { metric: 'unmatchedQuota' }]
  ] as const)('navigates %s with a non-empty exact selector', (_key, title, expected) => {
    const navigations: Array<{ page: string; query?: Record<string, string | undefined> }> = [];
    render(<AttentionNeededCard
      rows={[{ key: _key, title, count: 2, severity: 'urgent', page: 'approvalCenter' }]}
      expiringLicenses={[]}
      expiringCount={0}
      loading={false}
      onNavigate={(page, query) => navigations.push({ page, query })}
    />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }));
    expect(navigations).toEqual([{ page: 'dashboardDetails', query: expected }]);
    expect(Object.values(navigations[0].query || {}).every((value) => value !== '')).toBe(true);
  });
});
