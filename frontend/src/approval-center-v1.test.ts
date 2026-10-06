import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const main = read('main.tsx');
const client = read('approval-center-client.ts');
const page = read('pages/approvals/ApprovalCenterPage.tsx');
const review = read('components/personnel/EmployeeChangeReviewModal.tsx');
const css = read('styles/approval-center.css');

describe('Approval Center Command Nexus frontend contracts', () => {
  it('keeps Approval Center role scope and the existing aggregate API', () => {
    expect(main).toContain("{ label: 'ตรวจสอบ', items: [");
    expect(main).toContain("{ id: 'approvalCenter', icon: 'bell', label: 'ศูนย์อนุมัติ' }");
    expect(main).toContain("if (page === 'approvalCenter') return ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(auth.user?.role || '')");
    expect(client).toContain("approvalCenterRequest(token, '/approval-center/summary')");
    expect(client).toContain("approvalCenterRequest(token, '/approval-center?limit=100')");
  });

  it('renders the zero-white command-nexus surface and real telemetry fallbacks', () => {
    expect(page).toContain('ศูนย์อนุมัติ');
    expect(page).toContain('Approval Center &amp; Incident Logs');
    expect(page).toContain('bg-[#020813]');
    expect(page).toContain('bg-[#061421]');
    expect(page).toContain('bg-[#020f1c]');
    expect(page).toContain('bg-[#0f1d2a]');
    expect(page).toContain('text-white');
    expect(page).not.toContain('AWAITING TELEMETRY');
    expect(page).toContain('metric.loading ? <span');
    expect(page).toContain('metric.value !== null');
    expect(page).toContain('value: summaryAvailable ? String(summary.total) : null');
    expect(page).not.toContain('bg-white');
    expect(css).toContain('.nexus-approval-center{background:#020813!important');
  });

  it('keeps every supported approval type and routes direct decisions through existing APIs', () => {
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

    expect(page).toContain('api.approveEmployeeReferencePhoto');
    expect(page).toContain('api.rejectEmployeeReferencePhoto');
    expect(page).toContain('api.approveLicenseDocument');
    expect(page).toContain('api.rejectLicenseDocument');
    expect(page).toContain('api.approveAttendanceDeviceRequest');
    expect(page).toContain('api.rejectAttendanceDeviceRequest');
    expect(page).toContain('approveAttendanceAdjustment(token, item.requestId)');
    expect(page).toContain('rejectAttendanceAdjustment(token, item.requestId, reason)');
    expect(page).toContain('api.approveRegistrationRequest');
    expect(page).toContain('api.rejectRegistrationRequest');
    expect(page).toContain("api.updateUser(token, item.requestId, { accountStatus: 'ACTIVE', isActive: true })");
    expect(page).toContain("api.updateUser(token, item.requestId, { accountStatus: 'REJECTED', isActive: false })");
  });

  it('preserves governed review paths for employee changes and leave', () => {
    expect(page).toContain('onOpenEmployeeChange(item.requestId)');
    expect(page).toContain("if (item.type === 'LEAVE_REQUEST')");
    expect(page).toContain("onLeaveDecision(item, action)");
    expect(page).toContain("onLeaveDecision(item, 'reject')");
    expect(page).toContain('selectedLeaveIsSelf');
    expect(page).not.toContain('backend ยังคงตรวจสอบสิทธิ์อีกชั้นหนึ่ง');
    expect(main).toContain('onLeaveDecision={(item, action) => openLeaveDecision(');
    expect(main).toContain('await api.returnLeaveRequestForCorrection');
    expect(main).toContain("await api.updateLeaveRequest(auth.token, id, { status: request.action === 'approve' ? 'APPROVED' : 'REJECTED' })");
    expect(review).toContain('revision.beforeSnapshot[field]');
    expect(review).toContain('revision.afterSnapshot[field]');
  });

  it('uses the existing admin-only audit API without widening permissions', () => {
    expect(page).toContain("if (role !== 'ADMIN')");
    expect(page).toContain('api.auditEvents(token, 1, 100');
    expect(page).toContain("category: 'all'");
    expect(page).not.toContain('Audit API จำกัดสิทธิ์ Admin ตามเดิม');
    expect(page).toContain('onOpenAudit');
    expect(main).toContain("onOpenAudit={() => setActivePage('audit')}");
  });

  it('implements requested desktop split, category filters, urgency filters, and mobile tabs', () => {
    expect(page).toContain("type CategoryFilter = 'ALL' | 'LEAVE'");
    expect(page).toContain("type MobileTab = 'QUEUE' | 'AUDIT'");
    expect(page).not.toContain('Shift Swap');
    expect(page).not.toContain('Secure Vault Access');
    expect(page).toContain('ขอลางาน (Leave)');
    expect(page).toContain('ด่วนที่สุด (Urgent)');
    expect(page).toContain('ปกติ (Standard)');
    expect(page).toContain('lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]');
    expect(page).toContain('คำขอรออนุมัติ ({visible.length})');
    expect(page).toContain('บันทึกเหตุการณ์สด (Live Log)');
    expect(page).toContain('overflow-x-hidden');
    expect(page).toContain('aria-pressed={selected?.id === item.id}');
    expect(css).toContain('.nexus-audit-dot--critical');
    expect(page).not.toContain('backend ยังคงตรวจสอบสิทธิ์อีกชั้นหนึ่ง');
  });
});
