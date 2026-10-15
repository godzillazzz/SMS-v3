// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCenterPage } from './ApprovalCenterPage';

const mocks = vi.hoisted(() => ({ getApprovalCenter: vi.fn(), getApprovalCenterSummary: vi.fn() }));

vi.mock('../../approval-center-client', () => ({ getApprovalCenter: mocks.getApprovalCenter, getApprovalCenterSummary: mocks.getApprovalCenterSummary }));
vi.mock('../../pages/attendance-supervisor/attendance-adjustment-client', () => ({
  approveAttendanceAdjustment: vi.fn(),
  rejectAttendanceAdjustment: vi.fn()
}));

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

describe('ApprovalCenterPage R3 queue display', () => {
  it('keeps request UUIDs out of desktop and mobile queue content while showing the sender and icon', async () => {
    const requestUuid = 'd843de4c-f2d6-4cdd-9f52-0123456789ab';
    mocks.getApprovalCenter.mockResolvedValue({
      data: [{
        id: 'approval-row-1',
        requestId: requestUuid,
        type: 'SCHEDULE_APPROVAL',
        title: 'ตารางกะ เดือนตุลาคม',
        status: 'PENDING',
        sourcePage: 'approvals',
        submittedAt: '2026-10-07T00:00:00.000Z',
        ageHours: 1,
        urgency: 'NEW',
        employee: { id: 'employee-1', displayName: 'พนักงานตัวอย่าง', department: 'AN1' },
        requestedBy: { id: 'user-1', displayName: 'ผู้ส่งตัวอย่าง', role: 'SUPERVISOR' }
      }],
      summary: { total: 1, dueSoon: 0, overdue: 0 }
    });
    mocks.getApprovalCenterSummary.mockResolvedValue({ summary: { total: 1, byType: { SCHEDULE_APPROVAL: 1 } } });

    const { container } = render(<ApprovalCenterPage
      token="test-token"
      role="SUPERVISOR"
      onChanged={vi.fn()}
      onOpenEmployeeChange={vi.fn()}
      onNavigate={vi.fn()}
      onLeaveDecision={vi.fn()}
    />);

    expect(await screen.findAllByText('ผู้ส่ง: ผู้ส่งตัวอย่าง')).toHaveLength(2);
    expect(screen.getAllByText('พนักงานตัวอย่าง')).toHaveLength(2);
    await waitFor(() => expect(mocks.getApprovalCenter).toHaveBeenCalledTimes(1));
    expect(mocks.getApprovalCenterSummary).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(requestUuid);
    expect(container.querySelectorAll('.nexus-approval-select svg')).toHaveLength(2);
  });
});

it('manual refresh bypasses summary cache, keeps list fetching and notifies global counts', async () => {
  mocks.getApprovalCenter.mockResolvedValue({ data: [], summary: { total: 0 } });
  mocks.getApprovalCenterSummary.mockResolvedValue({ summary: { total: 0, byType: {} } });
  const onChanged = vi.fn();
  const onSummaryLoaded = vi.fn();
  render(<ApprovalCenterPage token="test-token" role="ADMIN" onChanged={onChanged} onSummaryLoaded={onSummaryLoaded}
    onOpenEmployeeChange={vi.fn()} onNavigate={vi.fn()} onLeaveDecision={vi.fn()} />);
  await waitFor(() => expect(mocks.getApprovalCenterSummary).toHaveBeenCalledTimes(1));
  await waitFor(() => expect((screen.getByRole('button', { name: 'รีเฟรชข้อมูล' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'รีเฟรชข้อมูล' }));
  await waitFor(() => expect(onSummaryLoaded).toHaveBeenCalledTimes(2));
  expect(onChanged).not.toHaveBeenCalled();
  expect(mocks.getApprovalCenterSummary).toHaveBeenLastCalledWith('test-token', { forceRefresh: true });
  expect(mocks.getApprovalCenter).toHaveBeenCalledTimes(2);
});
