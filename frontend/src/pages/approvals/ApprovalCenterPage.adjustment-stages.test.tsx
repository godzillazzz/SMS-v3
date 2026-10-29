// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCenterPage } from './ApprovalCenterPage';

const mocks = vi.hoisted(() => ({
  getApprovalCenter: vi.fn(),
  getApprovalCenterSummary: vi.fn(),
  getApprovalCenterItem: vi.fn(),
  approveAttendanceAdjustment: vi.fn(),
  reviewAttendanceAdjustment: vi.fn(),
  returnAttendanceAdjustment: vi.fn(),
  rejectAttendanceAdjustment: vi.fn()
}));

vi.mock('../../approval-center-client', () => ({
  getApprovalCenter: mocks.getApprovalCenter,
  getApprovalCenterSummary: mocks.getApprovalCenterSummary,
  getApprovalCenterItem: mocks.getApprovalCenterItem,
  invalidateApprovalCenter: vi.fn()
}));
vi.mock('../../api', () => ({ api: {} }));
vi.mock('../../pages/attendance-supervisor/attendance-adjustment-client', () => ({
  approveAttendanceAdjustment: mocks.approveAttendanceAdjustment,
  reviewAttendanceAdjustment: mocks.reviewAttendanceAdjustment,
  returnAttendanceAdjustment: mocks.returnAttendanceAdjustment,
  rejectAttendanceAdjustment: mocks.rejectAttendanceAdjustment
}));

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

describe('ApprovalCenterPage Attendance Adjustment multi-stage actions', () => {
  it('forwards PENDING_SUPERVISOR stage using reviewAttendanceAdjustment instead of 409 approve', async () => {
    mocks.getApprovalCenter.mockResolvedValue({
      data: [{
        id: 'row-adj-1', requestId: 'adj-1', type: 'ATTENDANCE_ADJUSTMENT_REQUEST',
        title: 'ขอแก้ไขเวลาลงงาน', status: 'PENDING_SUPERVISOR',
        sourcePage: 'attendanceSupervisor', submittedAt: '2026-10-28T00:00:00.000Z', ageHours: 2, urgency: 'NEW',
        employee: { id: 'employee-1', displayName: 'สมชาย รักชาติ', department: 'กะเหนือ' },
        metadata: { workDate: '2026-10-27', requestType: 'ADJUST_WORK_TIME', revision: 1 }
      }],
      summary: { total: 1, dueSoon: 0, overdue: 0 }
    });
    mocks.getApprovalCenterSummary.mockResolvedValue({ summary: { total: 1, byType: { ATTENDANCE_ADJUSTMENT_REQUEST: 1 } } });
    mocks.reviewAttendanceAdjustment.mockResolvedValue({});

    render(<ApprovalCenterPage token="tok" role="ADMIN" onChanged={vi.fn()} onOpenEmployeeChange={vi.fn()} onNavigate={vi.fn()} onLeaveDecision={vi.fn()} />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'พิจารณา' }))[0]);
    const forwardBtn = await screen.findByRole('button', { name: 'ส่งต่อให้ผู้จัดการ' });
    expect(forwardBtn).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ส่งกลับแก้ไข' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'อนุมัติ…' })).toBeNull();

    fireEvent.click(forwardBtn);
    expect(await screen.findByText('ส่งต่อให้ผู้จัดการพิจารณา?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันส่งต่อ' }));

    await waitFor(() => {
      expect(mocks.reviewAttendanceAdjustment).toHaveBeenCalledWith('tok', 'adj-1', 'หัวหน้างานส่งต่อให้ผู้จัดการ');
      expect(mocks.approveAttendanceAdjustment).not.toHaveBeenCalled();
    });
  });

  it('forwards PENDING_MANAGER stage to ADMIN using reviewAttendanceAdjustment', async () => {
    mocks.getApprovalCenter.mockResolvedValue({
      data: [{
        id: 'row-adj-2', requestId: 'adj-2', type: 'ATTENDANCE_ADJUSTMENT_REQUEST',
        title: 'ขอแก้ไขเวลาลงงาน', status: 'PENDING_MANAGER',
        sourcePage: 'attendanceSupervisor', submittedAt: '2026-10-28T00:00:00.000Z', ageHours: 4, urgency: 'NEW',
        employee: { id: 'employee-2', displayName: 'สมหญิง ขยัน', department: 'กะใต้' },
        metadata: { workDate: '2026-10-27', requestType: 'ADJUST_WORK_TIME', revision: 1 }
      }],
      summary: { total: 1, dueSoon: 0, overdue: 0 }
    });
    mocks.getApprovalCenterSummary.mockResolvedValue({ summary: { total: 1, byType: { ATTENDANCE_ADJUSTMENT_REQUEST: 1 } } });
    mocks.reviewAttendanceAdjustment.mockResolvedValue({});

    render(<ApprovalCenterPage token="tok" role="ADMIN" onChanged={vi.fn()} onOpenEmployeeChange={vi.fn()} onNavigate={vi.fn()} onLeaveDecision={vi.fn()} />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'พิจารณา' }))[0]);
    const forwardBtn = await screen.findByRole('button', { name: 'ส่งต่อให้ Admin' });
    expect(forwardBtn).toBeTruthy();
    fireEvent.click(forwardBtn);
    expect(await screen.findByText('ส่งต่อให้ผู้ดูแลระบบอนุมัติ?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันส่งต่อ' }));

    await waitFor(() => {
      expect(mocks.reviewAttendanceAdjustment).toHaveBeenCalledWith('tok', 'adj-2', 'ผู้จัดการส่งต่อให้ Admin');
      expect(mocks.approveAttendanceAdjustment).not.toHaveBeenCalled();
    });
  });

  it('approves PENDING_ADMIN stage directly using approveAttendanceAdjustment', async () => {
    mocks.getApprovalCenter.mockResolvedValue({
      data: [{
        id: 'row-adj-3', requestId: 'adj-3', type: 'ATTENDANCE_ADJUSTMENT_REQUEST',
        title: 'ขอแก้ไขเวลาลงงาน', status: 'PENDING_ADMIN',
        sourcePage: 'attendanceSupervisor', submittedAt: '2026-10-28T00:00:00.000Z', ageHours: 6, urgency: 'NEW',
        employee: { id: 'employee-3', displayName: 'ประสิทธิ์ มุ่งมั่น', department: 'กะกลาง' },
        metadata: { workDate: '2026-10-27', requestType: 'ADJUST_WORK_TIME', revision: 1 }
      }],
      summary: { total: 1, dueSoon: 0, overdue: 0 }
    });
    mocks.getApprovalCenterSummary.mockResolvedValue({ summary: { total: 1, byType: { ATTENDANCE_ADJUSTMENT_REQUEST: 1 } } });
    mocks.approveAttendanceAdjustment.mockResolvedValue({});

    render(<ApprovalCenterPage token="tok" role="ADMIN" onChanged={vi.fn()} onOpenEmployeeChange={vi.fn()} onNavigate={vi.fn()} onLeaveDecision={vi.fn()} />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'พิจารณา' }))[0]);
    const approveBtn = await screen.findByRole('button', { name: 'อนุมัติ…' });
    expect(approveBtn).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ปฏิเสธ' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ส่งกลับไปแก้ไข' })).toBeTruthy();

    fireEvent.click(approveBtn);
    expect(await screen.findByText('อนุมัติขอแก้ไขเวลาลงงาน?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันอนุมัติ' }));

    await waitFor(() => {
      expect(mocks.approveAttendanceAdjustment).toHaveBeenCalledWith('tok', 'adj-3');
    });
  });
});
