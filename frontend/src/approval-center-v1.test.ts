import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const main = read('main.tsx');
const client = read('approval-center-client.ts');
const page = read('pages/approvals/ApprovalCenterPage.tsx');
const dashboard = read('pages/dashboard/DashboardPage.tsx');
const review = read('components/personnel/EmployeeChangeReviewModal.tsx');
const css = read('styles/approval-center.css');

describe('Approval Center V2 unified frontend contracts', () => {
  it('moves Approval Center into the review navigation group for Admin and Manager', () => {
    expect(main).toContain("{ label: 'ตรวจสอบ', items: [");
    expect(main).toContain("{ id: 'approvalCenter', icon: 'bell', label: 'Approval Center' }");
    expect(main).toContain("if (page === 'approvalCenter') return ['ADMIN', 'MANAGER'].includes(auth.user?.role || '')");
    expect(main).toContain("!['ADMIN', 'MANAGER'].includes(auth.user?.role || '')");
    expect(main).toContain("['ADMIN', 'MANAGER'].includes(auth.user?.role || '') && !auth.isViewingAs && <button type=\"button\" className=\"topbar-notification-button\"");
  });

  it('polls a lightweight role-scoped summary and refreshes when the tab becomes visible', () => {
    expect(client).toContain("approvalCenterRequest(token, '/approval-center/summary')");
    expect(client).toContain("approvalCenterRequest(token, '/approval-center?limit=100')");
    expect(main).toContain('getApprovalCenterSummary(auth.token!)');
    expect(main).toContain('window.setInterval(refreshApprovalCount, 60000)');
    expect(main).toContain("document.addEventListener('visibilitychange'");
  });

  it('renders every supported actionable workflow in one queue', () => {
    for (const type of [
      'EMPLOYEE_MASTER_CHANGE',
      'EMPLOYEE_REFERENCE_PHOTO',
      'LICENSE_DOCUMENT',
      'ATTENDANCE_DEVICE_REQUEST',
      'ATTENDANCE_ADJUSTMENT_REQUEST',
      'REGISTRATION_REQUEST',
      'USER_ACCESS',
      'LEAVE_REQUEST'
    ]) expect(page).toContain(type);
    expect(page).toContain('งานที่รอฉันดำเนินการ');
    expect(page).toContain('เปิดหน้าดำเนินการ');
    expect(page).toContain('onNavigate(selected)');
    expect(page).toContain("item?.type === 'REGISTRATION_REQUEST'");
    expect(page).toContain('matchedEmployeeCode');
    expect(page).toContain('matchedEmployeeName');
  });

  it('keeps authoritative complex review workflows in their existing modules', () => {
    expect(page).toContain('onOpenEmployeeChange(selected.requestId)');
    expect(page).toContain('api.viewEmployeeReferencePhoto');
    expect(page).toContain('api.approveEmployeeReferencePhoto');
    expect(page).toContain('api.rejectEmployeeReferencePhoto');
    expect(page).toContain('การอนุมัติ/ไม่อนุมัติจะดำเนินการที่โมดูลต้นทาง');
    expect(page).not.toContain('SCHEDULE_APPROVAL');
    expect(main).not.toContain("item.type === 'SCHEDULE_APPROVAL'");
    expect(review).toContain('revision.beforeSnapshot[field]');
    expect(review).toContain('revision.afterSnapshot[field]');
  });

  it('shows 24h and 48h reminder states and unified detail styling', () => {
    expect(page).toContain("DUE_SOON: 'ครบ 24 ชม.'");
    expect(page).toContain("OVERDUE: 'เกิน 48 ชม.'");
    expect(dashboard).toContain('dashboard-approval-alert');
    expect(css).toContain('.approval-urgency--overdue');
    expect(css).toContain('.approval-center-source-meta');
  });
});
