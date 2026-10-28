// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ApprovalCenterPage, type ApprovalCenterItem } from './pages/approvals/ApprovalCenterPage';

const mocks = vi.hoisted(() => ({
  getApprovalCenter: vi.fn(),
  getApprovalCenterSummary: vi.fn(),
  getApprovalCenterItem: vi.fn()
}));
vi.mock('./approval-center-client', () => ({
  getApprovalCenter: mocks.getApprovalCenter,
  getApprovalCenterSummary: mocks.getApprovalCenterSummary,
  getApprovalCenterItem: mocks.getApprovalCenterItem
}));
vi.mock('./pages/attendance-supervisor/attendance-adjustment-client', () => ({
  approveAttendanceAdjustment: vi.fn(), rejectAttendanceAdjustment: vi.fn()
}));

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const item: ApprovalCenterItem = {
  id: 'attendance-adjustment:11111111-1111-4111-8111-111111111111',
  requestId: '11111111-1111-4111-8111-111111111111',
  type: 'ATTENDANCE_ADJUSTMENT_REQUEST',
  title: 'คำขอปรับปรุงเวลา Attendance',
  status: 'PENDING_ADMIN', sourcePage: 'attendanceSupervisor',
  submittedAt: '2026-10-27T11:28:00.000Z', ageHours: 27, urgency: 'DUE_SOON',
  employee: { id: 'employee-1', employeeCode: 'UAT-ST-20260902', displayName: 'Sermpong UAT', department: 'WCS' },
  requestedBy: { id: 'user-1', displayName: 'Sermpong UAT', role: 'ADMIN' },
  metadata: {
    requestType: 'ADJUST_WORK_TIME', workDate: '2026-10-26', revision: 2, reason: 'ทดสอบ',
    originalCheckInAt: '2026-10-26T00:01:00.000Z', originalCheckOutAt: '2026-10-26T10:02:00.000Z',
    proposedCheckInAt: '2026-10-26T00:30:00.000Z', proposedCheckOutAt: '2026-10-26T10:30:00.000Z'
  }
};

function renderPage() {
  mocks.getApprovalCenter.mockResolvedValue({ data: [item], summary: { total: 1 } });
  mocks.getApprovalCenterSummary.mockResolvedValue({ summary: { total: 1, byType: { ATTENDANCE_ADJUSTMENT_REQUEST: 1 } } });
  return render(<ApprovalCenterPage token="test-token" role="ADMIN" onChanged={vi.fn()} onOpenEmployeeChange={vi.fn()} onNavigate={vi.fn()} onLeaveDecision={vi.fn()} />);
}

describe('mobile approval panel includes attendance details inline', () => {
  it('shows localized work date, request type/revision and before-to-proposed times without fetching detail', async () => {
    renderPage();
    const mobileQueue = document.querySelector('.approval-queue-mobile')!;
    fireEvent.click(await within(mobileQueue as HTMLElement).findByRole('button', { name: 'พิจารณา' }));
    const panel = await screen.findByRole('complementary');
    expect(within(panel).getByText('26 ต.ค. 2569')).toBeTruthy();
    expect(within(panel).getByText('แก้ไขเวลาเข้างาน / ออกงาน')).toBeTruthy();
    expect(within(panel).getByText('ฉบับที่ 2')).toBeTruthy();
    expect(within(panel).getByText('07:01 → 07:30')).toBeTruthy();
    expect(within(panel).getByText('17:02 → 17:30')).toBeTruthy();
    expect(mocks.getApprovalCenterItem).not.toHaveBeenCalled();
  });

  it('keeps detail buttons in desktop markup but hides the panel detail button only on mobile', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('.approval-queue-desktop .approval-detail-button').length).toBe(1));
    expect(container.querySelectorAll('.approval-queue-mobile .approval-detail-button')).toHaveLength(0);
    expect(within(container.querySelector('.approval-queue-mobile') as HTMLElement).getByText('26 ต.ค. 2569 · ทดสอบ')).toBeTruthy();
    fireEvent.click(await within(container.querySelector('.approval-queue-mobile') as HTMLElement).findByRole('button', { name: 'พิจารณา' }));
    const panel = await screen.findByRole('complementary');
    const panelDetail = within(panel).getByRole('button', { name: 'ดูรายละเอียด' });
    expect(panelDetail.classList.contains('approval-decision-panel__detail')).toBe(true);
    const css = fs.readFileSync(path.join(__dirname, 'styles/approval-center.css'), 'utf8');
    expect(css).toMatch(/@media\(max-width:760px\)\{\.approval-decision-panel__detail\{display:none!important\}/);
    expect(css).toContain('.approval-decision-panel__actions .approval-action-buttons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%}');
  });
});
