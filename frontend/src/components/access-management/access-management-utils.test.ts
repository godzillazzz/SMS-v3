import { describe, expect, it, vi } from 'vitest';
import { accessManagementState, accessState, accessSummary, accountStatusLabel, canLoadAccessManagement, executeConfirmedViewAs, viewAsConfirmation, visibleAccountActions, type AccountRecord } from './access-management-utils';

const pending: AccountRecord = { id: 'pending', displayName: 'Pending', accountStatus: 'PENDING', isActive: false };
const active: AccountRecord = { id: 'active', displayName: 'Active', accountStatus: 'ACTIVE', isActive: true };
const suspended: AccountRecord = { id: 'suspended', displayName: 'Suspended', accountStatus: 'SUSPENDED', isActive: false, passwordResetRequired: true };

describe('access management presentation rules', () => {
  it('derives truthful account summary values from returned rows only', () => {
    expect(accessSummary([pending, active, suspended])).toEqual({ total: 3, active: 1, pending: 1, suspended: 1, resetRequired: 1 });
  });

  it('keeps manager actions limited to pending approval', () => {
    expect(visibleAccountActions('MANAGER', pending)).toEqual(['approve', 'details']);
    expect(visibleAccountActions('MANAGER', active)).toEqual(['details']);
  });

  it('keeps admin-only actions out of the manager experience', () => {
    expect(visibleAccountActions('MANAGER', pending)).not.toContain('reset-password');
    expect(visibleAccountActions('MANAGER', pending)).not.toContain('view-as');
  });

  it('shows View As only for an eligible non-self administrator target', () => {
    expect(visibleAccountActions('ADMIN', active, 'different-account')).toContain('view-as');
    expect(visibleAccountActions('ADMIN', active, active.id)).not.toContain('view-as');
    expect(visibleAccountActions('ADMIN', { ...active, passwordResetRequired: true }, 'different-account')).not.toContain('view-as');
  });

  it('never exposes View As to a manager, including for an active account', () => {
    expect(visibleAccountActions('MANAGER', active, 'different-account')).not.toContain('view-as');
  });

  it('executes View As only after confirmation and returns a safe failure state', async () => {
    const action = vi.fn<(id: string) => Promise<unknown>>();
    expect(action).not.toHaveBeenCalled();
    action.mockResolvedValueOnce(undefined);
    await expect(executeConfirmedViewAs(active.id, action)).resolves.toEqual({ ok: true });
    expect(action).toHaveBeenCalledTimes(1);

    action.mockRejectedValueOnce(new Error('sensitive upstream detail'));
    await expect(executeConfirmedViewAs(active.id, action)).resolves.toEqual({ ok: false, error: viewAsConfirmation.failureMessage });
  });

  it('uses a confirmation that explains read-only and time-limited access', () => {
    expect(viewAsConfirmation.description).toContain('อ่านอย่างเดียว');
    expect(viewAsConfirmation.description).toContain('ระยะเวลาจำกัด');
  });

  it('presents pending and suspended accounts distinctly', () => {
    expect(accountStatusLabel(pending)).toBe('รออนุมัติ');
    expect(accountStatusLabel(suspended)).toBe('ระงับใช้งาน');
  });

  it('covers loading, empty, and error presentation states', () => {
    expect(accessState(true, undefined, [])).toBe('loading');
    expect(accessState(false, undefined, [])).toBe('empty');
    expect(accessState(false, 'ไม่พร้อมใช้งาน', [])).toBe('error');
  });

  it('blocks Viewer account loading before the users API branch and renders permission denied', () => {
    expect(canLoadAccessManagement('VIEWER')).toBe(false);
    expect(accessManagementState('VIEWER', false, undefined, [active])).toBe('permission-denied');
    expect(visibleAccountActions('VIEWER', active)).toEqual([]);
  });
});
