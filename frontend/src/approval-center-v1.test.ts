import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const main = read('main.tsx');
const api = read('api.ts');
const page = read('pages/approvals/ApprovalCenterPage.tsx');
const dashboard = read('pages/dashboard/DashboardPage.tsx');
const review = read('components/personnel/EmployeeChangeReviewModal.tsx');
const css = read('styles/approval-center.css');

describe('Approval Center V1 frontend contracts', () => {
  it('surfaces pending approvals in sidebar and topbar bell for Admin', () => {
    expect(main).toContain("id: 'approvalCenter'");
    expect(main).toContain('topbar-notification-button');
    expect(main).toContain('pendingApprovalCount');
    expect(main).toContain("page === 'approvalCenter'");
    expect(main).toContain("auth.user?.role === 'ADMIN'");
  });

  it('polls the aggregated queue and refreshes when the tab becomes visible', () => {
    expect(api).toContain('approvalCenter:');
    expect(main).toContain('window.setInterval(refreshApprovalCount, 60000)');
    expect(main).toContain("document.addEventListener('visibilitychange'");
  });

  it('Approval Center combines Employee Master and Reference Photo reviews', () => {
    expect(page).toContain('EMPLOYEE_MASTER_CHANGE');
    expect(page).toContain('EMPLOYEE_REFERENCE_PHOTO');
    expect(page).toContain('api.viewEmployeeReferencePhoto');
    expect(page).toContain('api.approveEmployeeReferencePhoto');
    expect(page).toContain('api.rejectEmployeeReferencePhoto');
    expect(page).toContain('onOpenEmployeeChange(selected.requestId)');
  });

  it('fails closed when private Reference Photo evidence cannot be opened', () => {
    expect(page).toContain('const [photoLoading, setPhotoLoading] = useState(false)');
    expect(page).toContain("setError(toRequestErrorState(cause, 'ไม่สามารถเปิดรูปอ้างอิงที่รออนุมัติได้ กรุณารีเฟรชและตรวจสอบก่อนอนุมัติ'))");
    expect(page).toContain('disabled={busy || photoLoading || !photoUrl}');
    expect(page).toContain("const selected = visible.find((item) => item.id === selectedId) || visible[0]");
  });

  it('deep-links Employee Master work into the existing BEFORE to AFTER review modal', () => {
    expect(main).toContain('employeeChangeReviewInitialId');
    expect(review).toContain('initialRequestId');
    expect(review).toContain('revision.beforeSnapshot[field]');
    expect(review).toContain('revision.afterSnapshot[field]');
  });

  it('shows 24h and 48h reminder states and a dashboard warning card', () => {
    expect(page).toContain("DUE_SOON: 'ครบ 24 ชม.'");
    expect(page).toContain("OVERDUE: 'เกิน 48 ชม.'");
    expect(dashboard).toContain('dashboard-approval-alert');
    expect(dashboard).toContain('pendingApprovalCount > 0');
    expect(css).toContain('.approval-urgency--overdue');
  });
});
