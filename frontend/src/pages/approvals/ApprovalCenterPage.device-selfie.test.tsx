// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCenterPage } from './ApprovalCenterPage';

const mocks = vi.hoisted(() => ({
  getApprovalCenter: vi.fn(),
  getApprovalCenterSummary: vi.fn(),
  getApprovalCenterItem: vi.fn(),
  attendanceDeviceSelfieBlob: vi.fn()
}));

vi.mock('../../approval-center-client', () => ({
  getApprovalCenter: mocks.getApprovalCenter,
  getApprovalCenterSummary: mocks.getApprovalCenterSummary,
  getApprovalCenterItem: mocks.getApprovalCenterItem,
  invalidateApprovalCenter: vi.fn()
}));
vi.mock('../../api', () => ({ api: {} }));
vi.mock('../attendance/attendance-client', () => ({
  attendanceDeviceSelfieBlob: mocks.attendanceDeviceSelfieBlob
}));
vi.mock('../../pages/attendance-supervisor/attendance-adjustment-client', () => ({
  approveAttendanceAdjustment: vi.fn(),
  rejectAttendanceAdjustment: vi.fn(),
  reviewAttendanceAdjustment: vi.fn(),
  returnAttendanceAdjustment: vi.fn()
}));

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  global.URL.createObjectURL = vi.fn(() => 'blob:http://localhost/mock-selfie');
  global.URL.revokeObjectURL = vi.fn();
});

describe('ApprovalCenterPage ATTENDANCE_DEVICE_REQUEST selfie review', () => {
  it('renders selfie review toggle in decision panel and loads clock-in selfie image', async () => {
    mocks.getApprovalCenter.mockResolvedValue({
      data: [{
        id: 'device-req-1',
        requestId: 'req-1',
        type: 'ATTENDANCE_DEVICE_REQUEST',
        title: 'อุปกรณ์ลงเวลา',
        status: 'PENDING_APPROVAL',
        sourcePage: 'attendanceDevice',
        submittedAt: '2026-10-29T05:39:00.000Z',
        ageHours: 4,
        urgency: 'NEW',
        employee: { id: 'emp-101', displayName: 'Sermpong UAT', employeeCode: 'UAT-ST-20260902', department: 'WCS' },
        metadata: {
          requestType: 'NEW_DEVICE',
          reason: 'ยืนยันด้วย selfie สดจากเครื่องใหม่',
          candidateDeviceId: 'dev-999',
          employeeId: 'emp-101'
        }
      }],
      summary: { total: 1, dueSoon: 0, overdue: 0 }
    });
    mocks.getApprovalCenterSummary.mockResolvedValue({ summary: { total: 1, byType: { ATTENDANCE_DEVICE_REQUEST: 1 } } });
    mocks.attendanceDeviceSelfieBlob.mockResolvedValue(new Blob(['fake-img'], { type: 'image/jpeg' }));

    render(<ApprovalCenterPage token="token-xyz" role="ADMIN" onChanged={vi.fn()} onOpenEmployeeChange={vi.fn()} onNavigate={vi.fn()} onLeaveDecision={vi.fn()} />);

    // Open decision panel
    fireEvent.click((await screen.findAllByRole('button', { name: 'พิจารณา' }))[0]);

    // Check selfie button exists in panel
    const selfieBtn = await screen.findByRole('button', { name: /ดูรูปเซลฟี่จากการลงเวลา/ });
    expect(selfieBtn).toBeTruthy();

    // Click toggle to load selfie
    fireEvent.click(selfieBtn);
    await waitFor(() => {
      expect(mocks.attendanceDeviceSelfieBlob).toHaveBeenCalledWith('token-xyz', 'emp-101', 'dev-999');
    });

    // Check selfie image is displayed with disclaimer
    const img = await screen.findByAltText(/รูปเซลฟี่จากการลงเวลาของ Sermpong UAT/);
    expect(img).toBeTruthy();
    expect(screen.getByText('รูปเซลฟี่จากการลงเวลา ไม่ใช่รูปแนบคำขอ')).toBeTruthy();

    // Toggle button changes to "ซ่อนรูปเซลฟี่"
    expect(screen.getByRole('button', { name: /ซ่อนรูปเซลฟี่/ })).toBeTruthy();
  });
});
