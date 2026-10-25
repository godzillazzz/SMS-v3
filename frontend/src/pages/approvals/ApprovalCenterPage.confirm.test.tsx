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

    expect(screen.queryByRole('button', { name: 'อนุมัติ…' })).toBeNull();
    fireEvent.click((await screen.findAllByRole('button', { name: 'พิจารณา' }))[0]);
    const approve = await screen.findByRole('button', { name: 'อนุมัติ…' });
    fireEvent.click(approve);
    expect(await screen.findByText('อนุมัติเอกสารใบอนุญาต?')).toBeTruthy();
    expect(document.getElementById('sms-action-dialog-description')?.textContent).toMatch(/มีผลกับการตรวจสิทธิ์ตอนจัดกะ/);
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
    expect(screen.queryByRole('button', { name: 'อนุมัติ…' })).toBeNull();
    fireEvent.click((await screen.findAllByRole('button', { name: 'พิจารณา' }))[0]);
    const approve = await screen.findByRole('button', { name: 'อนุมัติ…' });
    fireEvent.click(approve);
    fireEvent.click(await screen.findByRole('button', { name: 'ยกเลิก' }));
    await waitFor(() => expect(screen.queryByText('อนุมัติเอกสารใบอนุญาต?')).toBeNull());
    expect(mocks.approveLicenseDocument).not.toHaveBeenCalled();
  });

  it('opens the W-02 decision panel with facts and consequence; rows never decide directly', async () => {
    mocks.getApprovalCenter.mockResolvedValue({
      data: [{ id: 'row-3', requestId: 'req-3', type: 'LEAVE_REQUEST', title: 'ลาพักร้อน', status: 'PENDING', sourcePage: 'leavePending', submittedAt: '2026-10-21T00:00:00.000Z', ageHours: 50, urgency: 'OVERDUE', sla: { overdueHours: 2 },
        metadata: { leaveType: 'ลาพักร้อน', startDate: '2026-10-26', endDate: '2026-10-28', dayCount: 3, substitute: 'ประเสริฐ มั่นคง' },
        employee: { id: 'e3', displayName: 'อรุณี แสงทอง', employeeCode: 'SG-0031', department: 'บางนา' } }],
      summary: { total: 1 }
    });
    mocks.getApprovalCenterSummary.mockResolvedValue({ summary: { total: 1, byType: { LEAVE_REQUEST: 1 } } });
    render(<ApprovalCenterPage token="t" role="ADMIN" onChanged={vi.fn()} onOpenEmployeeChange={vi.fn()} onNavigate={vi.fn()} onLeaveDecision={vi.fn()} />);
    expect(await screen.findAllByRole('button', { name: 'พิจารณา' })).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: /อรุณี แสงทอง/ })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'พิจารณา' })[0]);
    const panel = await screen.findByRole('complementary', { name: 'อรุณี แสงทอง · คำขอลา' });
    expect(panel.textContent).toContain('ประเสริฐ มั่นคง');
    expect(panel.textContent).toContain('3 วัน');
    expect(panel.textContent).toContain('ถ้าอนุมัติ');
    expect(panel.textContent).toContain('ลง AL แทนกะเดิม');
    expect(panel.querySelector('.approval-action-button--approve')).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'อรุณี แสงทอง · คำขอลา' })).toBeNull());
  });
});
