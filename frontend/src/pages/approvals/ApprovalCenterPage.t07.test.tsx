// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCenterPage, type ApprovalCenterItem } from './ApprovalCenterPage';

const mocks = vi.hoisted(() => ({ getApprovalCenter: vi.fn(), getApprovalCenterSummary: vi.fn() }));

vi.mock('../../approval-center-client', () => ({
  getApprovalCenter: mocks.getApprovalCenter,
  getApprovalCenterSummary: mocks.getApprovalCenterSummary
}));
vi.mock('../../pages/attendance-supervisor/attendance-adjustment-client', () => ({
  approveAttendanceAdjustment: vi.fn(),
  rejectAttendanceAdjustment: vi.fn()
}));

const leaveItem: ApprovalCenterItem = {
  id: 'leave:request-1',
  requestId: 'request-1',
  type: 'LEAVE_REQUEST',
  title: 'คำขอลา',
  status: 'PENDING',
  sourcePage: 'leavePending',
  submittedAt: '2026-10-05T02:30:00.000Z',
  ageHours: 49,
  urgency: 'OVERDUE',
  sla: { dueSoonHours: 24, overdueHours: 48 },
  employee: { id: 'employee-1', displayName: 'พนักงานตัวอย่าง', department: 'AN1' },
  requestedBy: { id: 'user-1', displayName: 'ผู้ส่งคำขอ', role: 'MANAGER' },
  metadata: {
    leaveType: 'ลาพักร้อน',
    startDate: '2026-10-10',
    endDate: '2026-10-11',
    dayCount: '2'
  }
};

const scheduleItem: ApprovalCenterItem = {
  id: 'schedule-approval:approval-1',
  requestId: 'approval-1',
  type: 'SCHEDULE_APPROVAL',
  title: 'ตารางกะ ตุลาคม 2569 ฉบับที่ 4',
  status: 'PENDING',
  sourcePage: 'approvals',
  submittedAt: '2026-10-06T06:15:00.000Z',
  ageHours: 4,
  urgency: 'NEW',
  metadata: { month: '2026-10-01T00:00:00.000Z', revision: 4 }
};

const registrationItem: ApprovalCenterItem = {
  id: 'registration:request-1',
  requestId: 'request-1',
  type: 'REGISTRATION_REQUEST',
  title: 'คำขอลงทะเบียนรอจับคู่พนักงาน',
  status: 'PENDING',
  sourcePage: 'users',
  submittedAt: '2026-10-06T07:15:00.000Z',
  ageHours: 2,
  urgency: 'NEW',
  requestedBy: { displayName: 'ผู้สมัครตัวอย่าง', role: 'REQUESTER' },
  metadata: { departmentHint: 'AN1' }
};

function renderPage(role: string) {
  const onNavigate = vi.fn();
  render(<ApprovalCenterPage
    token="test-token"
    role={role}
    onChanged={vi.fn()}
    onOpenEmployeeChange={vi.fn()}
    onNavigate={onNavigate}
    onLeaveDecision={vi.fn()}
  />);
  return { onNavigate };
}

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApprovalCenter.mockResolvedValue({ data: [leaveItem, scheduleItem], summary: { total: 2, truncated: false } });
});

describe('ApprovalCenterPage unified approval inbox', () => {
  it.each(['ADMIN', 'MANAGER', 'SUPERVISOR'])('uses server-authorized byType values for %s', async (role) => {
    mocks.getApprovalCenterSummary.mockResolvedValue({
      summary: {
        total: 9,
        byType: {
          LEAVE_REQUEST: 5,
          SCHEDULE_APPROVAL: role === 'MANAGER' ? 0 : 4,
          REGISTRATION_REQUEST: 0,
          USER_ACCESS: 0,
          EMPLOYEE_MASTER_CHANGE: 0,
          EMPLOYEE_REFERENCE_PHOTO: 0,
          LICENSE_DOCUMENT: 0,
          ATTENDANCE_DEVICE_REQUEST: 0,
          ATTENDANCE_ADJUSTMENT_REQUEST: 0
        }
      }
    });

    renderPage(role);

    expect(await screen.findByRole('button', { name: 'ทั้งหมด 9' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'คำขอลา 5' })).toBeTruthy();
    if (role === 'MANAGER') {
      expect(screen.queryByRole('button', { name: 'อนุมัติตารางกะ 0' })).toBeNull();
    } else {
      expect(screen.getByRole('button', { name: 'อนุมัติตารางกะ 4' })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: /เอกสารใบอนุญาต/ })).toBeNull();
    expect(await screen.findByText('2 จาก 9 รายการ')).toBeTruthy();
    expect(screen.queryByText(/Event Stream|LIVE SECURITY AUDIT|บันทึกเหตุการณ์สด/)).toBeNull();
  });

  it('shows requester, Thai summary, submitted date, and API-provided pending age', async () => {
    mocks.getApprovalCenterSummary.mockResolvedValue({ summary: { total: 2, byType: { LEAVE_REQUEST: 1, SCHEDULE_APPROVAL: 1 } } });

    renderPage('SUPERVISOR');

    expect((await screen.findAllByText('ผู้ส่ง: ผู้ส่งคำขอ')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('ลาพักร้อน · 2026-10-10 – 2026-10-11 · 2 วัน').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2 วัน 1 ชม.').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ต\.ค\./).length).toBeGreaterThan(0);
  });

  it('localizes registration requester role and does not expose device request enums in summaries', async () => {
    const deviceItem: ApprovalCenterItem = {
      id: 'device:request-1',
      requestId: 'request-1',
      type: 'ATTENDANCE_DEVICE_REQUEST',
      title: 'อุปกรณ์ลงเวลา',
      status: 'PENDING_APPROVAL',
      sourcePage: 'attendanceDevice',
      submittedAt: '2026-10-06T07:15:00.000Z',
      ageHours: 2,
      urgency: 'NEW',
      requestedBy: { displayName: 'หัวหน้าตัวอย่าง', role: 'SUPERVISOR' },
      metadata: { requestType: 'INITIAL', reason: 'ลงทะเบียนเครื่องแรก' }
    };
    mocks.getApprovalCenter.mockResolvedValue({ data: [registrationItem, deviceItem], summary: { total: 2, truncated: false } });
    mocks.getApprovalCenterSummary.mockResolvedValue({ summary: { total: 2, byType: { REGISTRATION_REQUEST: 1, ATTENDANCE_DEVICE_REQUEST: 1 } } });

    renderPage('ADMIN');

    expect((await screen.findAllByText('ผู้ส่ง: ผู้สมัครตัวอย่าง')).length).toBeGreaterThan(0);
    expect(screen.getByText('ผู้สมัคร')).toBeTruthy();
    expect(screen.getAllByText('ลงทะเบียนเครื่องแรก').length).toBeGreaterThan(0);
    expect(screen.queryByText('INITIAL')).toBeNull();
  });

  it('filters by a positive server type count and opens schedule approval at its existing destination', async () => {
    mocks.getApprovalCenterSummary.mockResolvedValue({ summary: { total: 2, byType: { LEAVE_REQUEST: 1, SCHEDULE_APPROVAL: 1 } } });
    const { onNavigate } = renderPage('ADMIN');

    const scheduleFilter = await screen.findByRole('button', { name: 'อนุมัติตารางกะ 1' });
    fireEvent.click(scheduleFilter);
    expect(screen.getAllByText('ตารางกะ ตุลาคม 2569 ฉบับที่ 4').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'ดูรายละเอียดตารางกะ' })[0]);
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(scheduleItem));
  });
});
