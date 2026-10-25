// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCenterPage } from './ApprovalCenterPage';

const mocks = vi.hoisted(() => ({
  getApprovalCenter: vi.fn(),
  getApprovalCenterSummary: vi.fn(),
  getApprovalCenterItem: vi.fn(),
  approveLicenseDocument: vi.fn()
}));

vi.mock('../../approval-center-client', () => ({
  getApprovalCenter: mocks.getApprovalCenter,
  getApprovalCenterSummary: mocks.getApprovalCenterSummary,
  getApprovalCenterItem: mocks.getApprovalCenterItem,
  invalidateApprovalCenter: vi.fn()
}));
vi.mock('../../api', () => ({ api: { approveLicenseDocument: mocks.approveLicenseDocument } }));
vi.mock('../../pages/attendance-supervisor/attendance-adjustment-client', () => ({
  approveAttendanceAdjustment: vi.fn(),
  rejectAttendanceAdjustment: vi.fn()
}));

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

describe('ApprovalCenterPage confirm before approve (audit AC-01)', () => {
  it('opens a confirmation with the real consequence and approves only after confirming', async () => {
    mocks.getApprovalCenter.mockResolvedValue({
      data: [{
        id: 'row-1', requestId: 'req-1', type: 'LICENSE_DOCUMENT', title: 'ต่ออายุใบอนุญาต', status: 'PENDING',
        sourcePage: 'licenses', submittedAt: '2026-10-21T00:00:00.000Z', ageHours: 2, urgency: 'NEW',
        employee: { id: 'employee-1', displayName: 'มาลี รุ่งเรือง', department: 'สาทร' }
      }],
      summary: { total: 1, dueSoon: 0, overdue: 0 }
    });
    mocks.getApprovalCenterSummary.mockResolvedValue({ summary: { total: 1, byType: { LICENSE_DOCUMENT: 1 } } });
    mocks.approveLicenseDocument.mockResolvedValue({});

    render(<ApprovalCenterPage token="t" role="ADMIN" onChanged={vi.fn()} onOpenEmployeeChange={vi.fn()} onNavigate={vi.fn()} onLeaveDecision={vi.fn()} />);

    const [approve] = await screen.findAllByRole('button', { name: 'อนุมัติ…' });
    fireEvent.click(approve);
    expect(await screen.findByText('อนุมัติเอกสารใบอนุญาต?')).toBeTruthy();
    expect(screen.getByText(/มีผลกับการตรวจสิทธิ์ตอนจัดกะ/)).toBeTruthy();
    expect(mocks.approveLicenseDocument).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันอนุมัติ' }));
    await waitFor(() => expect(mocks.approveLicenseDocument).toHaveBeenCalledWith('t', 'req-1'));
  });

  it('does nothing when the confirmation is cancelled', async () => {
    mocks.getApprovalCenter.mockResolvedValue({
      data: [{ id: 'row-2', requestId: 'req-2', type: 'LICENSE_DOCUMENT', title: 'x', status: 'PENDING', sourcePage: 'licenses', submittedAt: '2026-10-21T00:00:00.000Z', ageHours: 1, urgency: 'NEW', employee: { id: 'e2', displayName: 'ก' } }],
      summary: { total: 1 }
    });
    mocks.getApprovalCenterSummary.mockResolvedValue({ summary: { total: 1, byType: { LICENSE_DOCUMENT: 1 } } });
    render(<ApprovalCenterPage token="t" role="ADMIN" onChanged={vi.fn()} onOpenEmployeeChange={vi.fn()} onNavigate={vi.fn()} onLeaveDecision={vi.fn()} />);
    const [approve] = await screen.findAllByRole('button', { name: 'อนุมัติ…' });
    fireEvent.click(approve);
    fireEvent.click(await screen.findByRole('button', { name: 'ยกเลิก' }));
    await waitFor(() => expect(screen.queryByText('อนุมัติเอกสารใบอนุญาต?')).toBeNull());
    expect(mocks.approveLicenseDocument).not.toHaveBeenCalled();
  });
});
