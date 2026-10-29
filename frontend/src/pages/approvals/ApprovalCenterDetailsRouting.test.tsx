// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCenterPage, type ApprovalCenterItem } from './ApprovalCenterPage';

const mocks = vi.hoisted(() => ({
  getApprovalCenter: vi.fn(),
  getApprovalCenterItem: vi.fn(),
  getApprovalCenterSummary: vi.fn()
}));

vi.mock('../../approval-center-client', () => ({
  getApprovalCenter: mocks.getApprovalCenter,
  getApprovalCenterItem: mocks.getApprovalCenterItem,
  getApprovalCenterSummary: mocks.getApprovalCenterSummary
}));

vi.mock('../../pages/attendance-supervisor/attendance-adjustment-client', () => ({
  approveAttendanceAdjustment: vi.fn(),
  rejectAttendanceAdjustment: vi.fn(),
  reviewAttendanceAdjustment: vi.fn(),
  returnAttendanceAdjustment: vi.fn()
}));

const mockItems: ApprovalCenterItem[] = [
  {
    id: 'leave:11111111-1111-4111-8111-111111111111',
    requestId: '11111111-1111-4111-8111-111111111111',
    type: 'LEAVE_REQUEST',
    title: 'คำขอลาพักร้อน',
    status: 'PENDING',
    sourcePage: 'leavePending',
    submittedAt: '2026-10-10T08:00:00Z',
    ageHours: 24,
    urgency: 'DUE_SOON',
    sla: { dueSoonHours: 24, overdueHours: 48 },
    employee: { id: 'emp-1', displayName: 'สมชาย สายตรวจ', department: 'รักษาความปลอดภัย' },
    requestedBy: { displayName: 'สมชาย สายตรวจ', role: 'VIEWER' },
    metadata: { leaveType: 'ลาพักร้อน', startDate: '2026-10-15', endDate: '2026-10-16', dayCount: '2' }
  },
  {
    id: 'schedule:22222222-2222-4222-8222-222222222222',
    requestId: '22222222-2222-4222-8222-222222222222',
    type: 'SCHEDULE_APPROVAL',
    title: 'ตารางกะ พฤศจิกายน 2569 ฉบับที่ 2',
    status: 'PENDING',
    sourcePage: 'schedule',
    submittedAt: '2026-10-11T09:00:00Z',
    ageHours: 12,
    urgency: 'NEW',
    requestedBy: { displayName: 'หัวหน้างาน สมศักดิ์', role: 'SUPERVISOR' },
    metadata: { month: '2026-11-01T00:00:00Z', revision: 2 }
  },
  {
    id: 'device:33333333-3333-4333-8333-333333333333',
    requestId: '33333333-3333-4333-8333-333333333333',
    type: 'ATTENDANCE_DEVICE_REQUEST',
    title: 'คำขอผูกอุปกรณ์ลงเวลาใหม่',
    status: 'PENDING_APPROVAL',
    sourcePage: 'attendanceDevice',
    submittedAt: '2026-10-11T10:00:00Z',
    ageHours: 5,
    urgency: 'NEW',
    employee: { id: 'emp-2', displayName: 'วิชัย มั่นคง', department: 'หน่วยปฏิบัติการ' },
    requestedBy: { displayName: 'วิชัย มั่นคง', role: 'VIEWER' },
    metadata: { deviceName: 'iPhone 15 Pro', reason: 'เปลี่ยนเครื่องปฏิบัติการ' }
  },
  {
    id: 'license:44444444-4444-4444-8444-444444444444',
    requestId: '44444444-4444-4444-8444-444444444444',
    type: 'LICENSE_DOCUMENT',
    title: 'เอกสารใบอนุญาต รปภ. ธภ.7',
    status: 'PENDING',
    sourcePage: 'licenses',
    submittedAt: '2026-10-11T11:00:00Z',
    ageHours: 3,
    urgency: 'NEW',
    employee: { id: 'emp-3', displayName: 'ประเสริฐ ชำนาญ', department: 'รปภ. ประจำจุด' },
    requestedBy: { displayName: 'ประเสริฐ ชำนาญ', role: 'VIEWER' },
    metadata: { licenseId: 'lic-123', documentId: 'doc-456' }
  },
  {
    id: 'emp_change:55555555-5555-4555-8555-555555555555',
    requestId: '55555555-5555-4555-8555-555555555555',
    type: 'EMPLOYEE_MASTER_CHANGE',
    title: 'ขอปรับเปลี่ยนตำแหน่งและสังกัด',
    status: 'PENDING',
    sourcePage: 'employees',
    submittedAt: '2026-10-11T12:00:00Z',
    ageHours: 2,
    urgency: 'NEW',
    employee: { id: 'emp-4', displayName: 'อนุสรณ์ แจ่มใส', department: 'รักษาความปลอดภัย' },
    requestedBy: { displayName: 'เจ้าหน้าที่บุคคล', role: 'ADMIN' },
    metadata: { changeType: 'DEPARTMENT_TRANSFER' },
    changedFields: ['department', 'position']
  },
  {
    id: 'emp_photo:66666666-6666-4666-8666-666666666666',
    requestId: '66666666-6666-4666-8666-666666666666',
    type: 'EMPLOYEE_REFERENCE_PHOTO',
    title: 'ขอเปลี่ยนรูปถ่ายใบหน้าอ้างอิง',
    status: 'PENDING',
    sourcePage: 'employees',
    submittedAt: '2026-10-11T13:00:00Z',
    ageHours: 1,
    urgency: 'NEW',
    employee: { id: 'emp-5', displayName: 'กิตติศักดิ์ ภักดี', department: 'สายตรวจ' },
    requestedBy: { displayName: 'กิตติศักดิ์ ภักดี', role: 'VIEWER' },
    metadata: { photoSource: 'ENROLLMENT_CAM' }
  },
  {
    id: 'adjust:77777777-7777-4777-8777-777777777777',
    requestId: '77777777-7777-4777-8777-777777777777',
    type: 'ATTENDANCE_ADJUSTMENT_REQUEST',
    title: 'ขอปรับปรุงเวลาเข้างาน ลืมลงเวลา',
    status: 'PENDING',
    sourcePage: 'attendanceSupervisor',
    submittedAt: '2026-10-11T14:00:00Z',
    ageHours: 1,
    urgency: 'NEW',
    employee: { id: 'emp-6', displayName: 'ประสิทธิ์ มงคล', department: 'ผลัดกลางคืน' },
    requestedBy: { displayName: 'ประสิทธิ์ มงคล', role: 'VIEWER' },
    metadata: { workDate: '2026-10-10', reason: 'ลืมสแกนนิ้ว' }
  },
  {
    id: 'reg:88888888-8888-4888-8888-888888888888',
    requestId: '88888888-8888-4888-8888-888888888888',
    type: 'REGISTRATION_REQUEST',
    title: 'คำขอลงทะเบียนผู้ใช้งานใหม่',
    status: 'PENDING',
    sourcePage: 'users',
    submittedAt: '2026-10-11T15:00:00Z',
    ageHours: 1,
    urgency: 'NEW',
    requestedBy: { displayName: 'นายธนกร พิทักษ์', role: 'REQUESTER' },
    metadata: { departmentHint: 'หน่วยปฏิบัติการพิเศษ' }
  },
  {
    id: 'user_acc:99999999-9999-4999-8999-999999999999',
    requestId: '99999999-9999-4999-8999-999999999999',
    type: 'USER_ACCESS',
    title: 'ขอปรับสิทธิ์การเข้าถึงเป็น SUPERVISOR',
    status: 'PENDING',
    sourcePage: 'users',
    submittedAt: '2026-10-11T16:00:00Z',
    ageHours: 1,
    urgency: 'NEW',
    requestedBy: { displayName: 'หัวหน้างาน วรวุฒิ', role: 'SUPERVISOR' },
    metadata: { accountId: '99999999-9999-4999-8999-999999999999', department: 'ฝ่ายปฏิบัติการ' }
  }
];

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/app/approvals');
  mocks.getApprovalCenter.mockResolvedValue({
    data: mockItems,
    summary: { total: mockItems.length, truncated: false }
  });
  mocks.getApprovalCenterItem.mockImplementation(async (_token: string, type: string, requestId: string) => {
    const item = mockItems.find((candidate) => candidate.type === type && candidate.requestId === requestId);
    return { data: item ? [item] : [] };
  });
  mocks.getApprovalCenterSummary.mockResolvedValue({
    summary: {
      total: mockItems.length,
      byType: {
        LEAVE_REQUEST: 1,
        SCHEDULE_APPROVAL: 1,
        ATTENDANCE_DEVICE_REQUEST: 1,
        LICENSE_DOCUMENT: 1,
        EMPLOYEE_MASTER_CHANGE: 1,
        EMPLOYEE_REFERENCE_PHOTO: 1,
        ATTENDANCE_ADJUSTMENT_REQUEST: 1,
        REGISTRATION_REQUEST: 1,
        USER_ACCESS: 1
      }
    }
  });
});

describe('T08 / T27 — Full Approval Details and Native Routing Across All 9 Types', () => {
  it('renders all 9 approval types with human-readable type labels and summaries without raw UUID leaks', async () => {
    render(
      <ApprovalCenterPage
        token="test-token"
        role="ADMIN"
        onChanged={vi.fn()}
        onOpenEmployeeChange={vi.fn()}
        onNavigate={vi.fn()}
        onLeaveDecision={vi.fn()}
      />
    );

    // Filter categories & type labels
    expect(await screen.findByRole('button', { name: 'คำขอลา 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'อนุมัติตารางกะ 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ลงทะเบียนบัญชี 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'เปิดสิทธิ์ผู้ใช้ 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'แก้ไขข้อมูลพนักงาน 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'รูปอ้างอิงพนักงาน 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'เอกสารใบอนุญาต 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'อุปกรณ์ลงเวลา 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ขอแก้ไขเวลาลงงาน 1' })).toBeTruthy();

    // Verify summaries
    expect(screen.getAllByText(/ลาพักร้อน/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('ตารางกะ พฤศจิกายน 2569 ฉบับที่ 2').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/เปลี่ยนเครื่องปฏิบัติการ/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('แก้ไข 2 รายการ').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ลืมสแกนนิ้ว/).length).toBeGreaterThan(0);

    // Verify no raw UUID is leaked in content
    expect(screen.queryByText('11111111-1111-4111-8111-111111111111')).toBeNull();
  });

  it('triggers onOpenEmployeeChange when "ดูรายละเอียดการแก้ไข" is clicked for EMPLOYEE_MASTER_CHANGE', async () => {
    const onOpenEmployeeChange = vi.fn();
    render(
      <ApprovalCenterPage
        token="test-token"
        role="ADMIN"
        onChanged={vi.fn()}
        onOpenEmployeeChange={onOpenEmployeeChange}
        onNavigate={vi.fn()}
        onLeaveDecision={vi.fn()}
      />
    );

    const button = (await screen.findAllByRole('button', { name: 'ดูรายละเอียดการแก้ไข' }))[0];
    fireEvent.click(button);

    await waitFor(() => {
      expect(onOpenEmployeeChange).toHaveBeenCalledWith('55555555-5555-4555-8555-555555555555');
    });
  });

  it('navigates to schedule view when "ดูรายละเอียดตารางกะ" is clicked for SCHEDULE_APPROVAL', async () => {
    const onNavigate = vi.fn();
    render(
      <ApprovalCenterPage
        token="test-token"
        role="MANAGER"
        onChanged={vi.fn()}
        onOpenEmployeeChange={vi.fn()}
        onNavigate={onNavigate}
        onLeaveDecision={vi.fn()}
      />
    );

    const button = (await screen.findAllByRole('button', { name: 'ดูรายละเอียดตารางกะ' }))[0];
    fireEvent.click(button);

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SCHEDULE_APPROVAL',
          requestId: '22222222-2222-4222-8222-222222222222',
          sourcePage: 'schedule'
        })
      );
    });
  });

  it('navigates to native target when "เปิดตรวจสอบคำขอลงทะเบียน" is clicked for REGISTRATION_REQUEST', async () => {
    const onNavigate = vi.fn();
    render(
      <ApprovalCenterPage
        token="test-token"
        role="ADMIN"
        onChanged={vi.fn()}
        onOpenEmployeeChange={vi.fn()}
        onNavigate={onNavigate}
        onLeaveDecision={vi.fn()}
      />
    );

    const button = (await screen.findAllByRole('button', { name: 'เปิดตรวจสอบคำขอลงทะเบียน' }))[0];
    fireEvent.click(button);

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'REGISTRATION_REQUEST',
          requestId: '88888888-8888-4888-8888-888888888888',
          sourcePage: 'users'
        })
      );
    });
  });

  it('displays Thai error alert when item detail fetch fails with 404', async () => {
    mocks.getApprovalCenterItem.mockRejectedValue({ status: 404 });

    render(
      <ApprovalCenterPage
        token="test-token"
        role="ADMIN"
        onChanged={vi.fn()}
        onOpenEmployeeChange={vi.fn()}
        onNavigate={vi.fn()}
        onLeaveDecision={vi.fn()}
      />
    );

    const buttons = await screen.findAllByRole('button', { name: 'ดูรายละเอียด' });
    fireEvent.click(buttons[0]);

    expect(await screen.findByText('ไม่พบคำขอที่ต้องการเปิดรายละเอียด (404)')).toBeTruthy();
  });
});
