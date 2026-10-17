// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCenterPage, type ApprovalCenterItem } from './ApprovalCenterPage';

const mocks = vi.hoisted(() => ({
  getApprovalCenter: vi.fn(),
  getApprovalCenterSummary: vi.fn(),
  getApprovalCenterItem: vi.fn()
}));

vi.mock('../../approval-center-client', () => ({
  getApprovalCenter: mocks.getApprovalCenter,
  getApprovalCenterSummary: mocks.getApprovalCenterSummary,
  getApprovalCenterItem: mocks.getApprovalCenterItem
}));
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
        sourcePage: 'schedule',
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

const targetCases: Array<{
  type: ApprovalCenterItem['type'];
  requestId: string;
  metadata?: Record<string, unknown>;
  employeeId?: string;
  destination: 'employee' | 'navigate' | 'schedule';
}> = [
  { type: 'EMPLOYEE_REFERENCE_PHOTO', requestId: 'photo-1', employeeId: 'employee-1', destination: 'navigate' },
  { type: 'EMPLOYEE_MASTER_CHANGE', requestId: 'change-1', employeeId: 'employee-2', destination: 'employee' },
  { type: 'USER_ACCESS', requestId: 'account-1', metadata: { accountId: 'account-1' }, destination: 'navigate' },
  { type: 'LICENSE_DOCUMENT', requestId: 'license-request-1', metadata: { licenseId: 'license-1', documentId: 'document-1' }, destination: 'navigate' },
  { type: 'ATTENDANCE_DEVICE_REQUEST', requestId: 'device-1', destination: 'navigate' },
  { type: 'ATTENDANCE_ADJUSTMENT_REQUEST', requestId: 'adjustment-1', destination: 'navigate' },
  { type: 'LEAVE_REQUEST', requestId: 'leave-1', destination: 'navigate' },
  { type: 'SCHEDULE_APPROVAL', requestId: 'schedule-1', destination: 'schedule' },
  { type: 'REGISTRATION_REQUEST', requestId: 'registration-1', destination: 'navigate' }
];

function approvalItem(testCase: typeof targetCases[number], id = `row-${testCase.requestId}`): ApprovalCenterItem {
  return {
    id, requestId: testCase.requestId, type: testCase.type, title: `Target ${testCase.type}`,
    status: 'PENDING', sourcePage: testCase.type === 'USER_ACCESS' ? 'users' : testCase.type === 'SCHEDULE_APPROVAL' ? 'schedule' : 'approvals',
    submittedAt: '2026-10-07T00:00:00.000Z', ageHours: 1, urgency: 'NEW',
    employee: testCase.employeeId ? { id: testCase.employeeId, displayName: 'Target employee' } : undefined,
    metadata: testCase.metadata
  };
}

function renderApprovalPage(item: ApprovalCenterItem, callbacks?: { onNavigate?: (item: ApprovalCenterItem) => void; onOpenEmployeeChange?: (requestId: string) => void }) {
  mocks.getApprovalCenter.mockResolvedValue({ data: [item], summary: { total: 1 } });
  mocks.getApprovalCenterSummary.mockResolvedValue({ summary: { total: 1, byType: { [item.type]: 1 } } });
  return render(<ApprovalCenterPage token="test-token" role="ADMIN" onChanged={vi.fn()}
    onOpenEmployeeChange={callbacks?.onOpenEmployeeChange || (() => undefined)}
    onNavigate={callbacks?.onNavigate || (() => undefined)} onLeaveDecision={vi.fn()} />);
}

describe('FE-VERIFY-003 approval target contracts', () => {
  it.each(targetCases)('opens the exact target for $type', async (testCase) => {
    const item = approvalItem(testCase);
    const onNavigate = vi.fn();
    const onOpenEmployeeChange = vi.fn();
    renderApprovalPage(item, { onNavigate, onOpenEmployeeChange });
    await screen.findAllByText(`Target ${testCase.type}`);
    mocks.getApprovalCenterItem.mockResolvedValue({ data: item });
    fireEvent.click(screen.getAllByRole('button', { name: /ดูรายละเอียด|เปิดตรวจสอบ/ })[0]);
    await waitFor(() => expect(mocks.getApprovalCenterItem).toHaveBeenCalledWith('test-token', testCase.type, testCase.requestId));
    if (testCase.destination === 'employee') {
      expect(onOpenEmployeeChange).toHaveBeenCalledWith(testCase.requestId);
      expect(onNavigate).not.toHaveBeenCalled();
    } else if (testCase.destination === 'navigate') {
      expect(onNavigate).toHaveBeenCalledWith(item);
    } else if (testCase.destination === 'schedule') {
      expect(onNavigate).toHaveBeenCalledWith(item);
      expect(screen.queryByRole('button', { name: 'อนุมัติทันที' })).toBeNull();
    } else {
      expect(onNavigate).not.toHaveBeenCalled();
      expect(screen.getAllByText(item.title).length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['loading', undefined, 'กำลังโหลดรายละเอียดคำขอ…'],
    ['404', Object.assign(new Error('missing'), { status: 404 }), 'ไม่พบคำขอที่ต้องการเปิดรายละเอียด (404)'],
    ['403', Object.assign(new Error('denied'), { status: 403 }), 'คุณไม่มีสิทธิ์ดูรายละเอียดคำขอนี้ (403)'],
    ['generic load-error', Object.assign(new Error('failed'), { status: 500 }), 'โหลดรายละเอียดคำขอไม่สำเร็จ กรุณาลองใหม่ (โหลดผิดพลาด)']
  ] as const)('exposes detail %s as role alert', async (_label, failure, message) => {
    const item = approvalItem(targetCases[0]);
    renderApprovalPage(item);
    await screen.findAllByText(item.title);
    let resolve!: (value: unknown) => void;
    mocks.getApprovalCenterItem.mockImplementation(() => failure ? Promise.reject(failure) : new Promise((res) => { resolve = res; }));
    fireEvent.click(screen.getAllByRole('button', { name: /ดูรายละเอียด/ })[0]);
    const stateRole = _label === 'loading' ? 'status' : 'alert';
    expect((await screen.findByRole(stateRole)).textContent).toContain(message);
    if (!failure) resolve({ data: item });
  });

  it('does not navigate when the detail response mismatches the requested target', async () => {
    const item = approvalItem(targetCases[0]);
    const other = approvalItem(targetCases[1], 'other-row');
    const onNavigate = vi.fn();
    renderApprovalPage(item, { onNavigate });
    await screen.findAllByText(item.title);
    mocks.getApprovalCenterItem.mockResolvedValue({ data: other });
    fireEvent.click(screen.getAllByRole('button', { name: /ดูรายละเอียด/ })[0]);
    expect((await screen.findByRole('alert')).textContent).toContain('ไม่พบคำขอ');
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('retains the target during a slow detail load and consumes it once after callback', async () => {
    const item = approvalItem(targetCases[0]);
    const onNavigate = vi.fn();
    renderApprovalPage(item, { onNavigate });
    await screen.findAllByText(item.title);
    let resolve!: (value: unknown) => void;
    mocks.getApprovalCenterItem.mockImplementation(() => new Promise((res) => { resolve = res; }));
    fireEvent.click(screen.getAllByRole('button', { name: /ดูรายละเอียด/ })[0]);
    expect((await screen.findByRole('status')).textContent).toContain('กำลังโหลดรายละเอียดคำขอ…');
    expect(screen.getAllByText(item.title).length).toBeGreaterThan(0);
    resolve({ data: item });
    await waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(1));
    expect(mocks.getApprovalCenterItem).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('single-flights duplicate clicks and ignores a superseded detail response', async () => {
    const first = approvalItem(targetCases[0]);
    const second = approvalItem(targetCases[2]);
    const onNavigate = vi.fn();
    mocks.getApprovalCenter.mockResolvedValue({ data: [first, second], summary: { total: 2 } });
    mocks.getApprovalCenterSummary.mockResolvedValue({ summary: { total: 2, byType: { [first.type]: 1, [second.type]: 1 } } });
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    mocks.getApprovalCenterItem.mockImplementation((_token: string, _type: string, requestId: string) => requestId === first.requestId
      ? new Promise((resolve) => { resolveFirst = resolve; })
      : new Promise((resolve) => { resolveSecond = resolve; }));
    render(<ApprovalCenterPage token="test-token" role="ADMIN" onChanged={vi.fn()}
      onOpenEmployeeChange={vi.fn()} onNavigate={onNavigate} onLeaveDecision={vi.fn()} />);
    await screen.findAllByText(first.title);
    const buttons = screen.getAllByRole('button', { name: /ดูรายละเอียด/ });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(mocks.getApprovalCenterItem).toHaveBeenCalledTimes(2);
    resolveSecond({ data: second });
    await waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(1));
    resolveFirst({ data: first });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onNavigate).toHaveBeenCalledWith(second);
    expect(onNavigate).not.toHaveBeenCalledWith(first);
  });
});
