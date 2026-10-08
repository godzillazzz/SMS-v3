import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const main = read('main.tsx');
const routing = read('routing.ts');
const client = read('approval-center-client.ts');
const page = read('pages/approvals/ApprovalCenterPage.tsx');
const registrationPanel = read('pages/access-management/RegistrationReviewPanel.tsx');
const review = read('components/personnel/EmployeeChangeReviewModal.tsx');
const css = read('styles/approval-center.css');
const approvalService = read('../../src/services/approval-center.service.js');

describe('Approval Center Command Nexus frontend contracts', () => {
  it('polls Approval Center summary every 60 seconds only while the document is visible', () => {
    expect(main).toContain('shouldPollApprovalCenter(document.visibilityState)');
    expect(main).toContain('window.setInterval(refreshApprovalCount, 60000)');
    expect(main).toContain("document.addEventListener('visibilitychange', onVisibility)");
  });

  it('keeps Approval Center role scope and the existing aggregate API', () => {
    expect(main).toContain("{ label: 'ตรวจสอบ', items: [");
    expect(main).toContain("{ id: 'approvalCenter', icon: 'bell', label: 'ศูนย์อนุมัติ' }");
    expect(routing).toContain("if (page === 'approvalCenter') return ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(auth.user?.role || '')");
    expect(client).toContain("approvalCenterRequest(token, '/approval-center/summary')");
    expect(client).toContain("approvalCenterRequest(token, '/approval-center?limit=100')");
  });

  it('keeps native review entry points for every currently actionable approval source', () => {
    expect(main).toContain("{ id: 'approvals', icon: 'approval', label: 'อนุมัติตารางกะ' }");
    expect(main).toContain("{ id: 'leavePending', icon: 'approval', label: 'อนุมัติคำขอลา' }");
    expect(routing).toContain("if (page === 'approvals') return ['ADMIN', 'SUPERVISOR'].includes(auth.user?.role || '') && !auth.isViewingAs");
    expect(routing).toContain("if (page === 'leavePending') return ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(auth.user?.role || '') && !auth.isViewingAs");
    expect(main).toContain('onNavigate={(item) => { if (item.type === \'REGISTRATION_REQUEST\') setRegistrationReviewInitialRequestId(item.requestId); setActivePage(item.sourcePage); }}');
    expect(approvalService).toMatch(/type: 'ATTENDANCE_ADJUSTMENT_REQUEST',[\s\S]{0,260}sourcePage: 'attendanceSupervisor'/);
    expect(page).toContain("type ApprovalSourcePage = 'employees' | 'licenses' | 'approvals' | 'attendanceDevice' | 'attendanceSupervisor' | 'users' | 'leavePending'");
  });

  it('renders the zero-white command-nexus surface and real telemetry fallbacks', () => {
    expect(page).toContain('ศูนย์อนุมัติ');
    expect(page).toContain('ศูนย์อนุมัติคำขอ');
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
      'SCHEDULE_APPROVAL',
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
    expect(page).toContain("SCHEDULE_APPROVAL: 'อนุมัติตารางกะ'");
    expect(page).toContain("type ApprovalSourcePage = 'employees' | 'licenses' | 'approvals' | 'attendanceDevice' | 'attendanceSupervisor' | 'users' | 'leavePending'");
    expect(page).toContain("if (item.type === 'SCHEDULE_APPROVAL') return 'ดูรายละเอียดตารางกะ'");
    expect(page).toContain('onNavigate(item)');
    expect(main).toContain("if (item.type === 'REGISTRATION_REQUEST') setRegistrationReviewInitialRequestId(item.requestId)");
    expect(main).toContain('initialRequestId={registrationReviewInitialRequestId}');
    expect(registrationPanel).toContain('api.registrationRequest(token, focusedRequestId)');
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

  it('keeps live audit events out of the pending approval queue', () => {
    expect(page).not.toContain('api.auditEvents');
    expect(page).not.toContain('AuditEvent');
    expect(page).not.toContain('Event Stream');
    expect(page).not.toContain('onOpenAudit');
    expect(main).toContain("{ id: 'audit', icon: 'audit', label: 'บันทึกการใช้งานระบบ' }");
  });

  it('uses server byType counts for permission-scoped type filters and retains presentation urgency filters', () => {
    expect(page).toContain("type CategoryFilter = 'ALL' | ApprovalType");
    expect(page).toContain('getApprovalCenterSummary(token)');
    expect(page).toContain('summary.byType?.[id]');
    expect(page).toContain('option.count > 0');
    expect(page).toContain('getApprovalCenterSummary(token)');
    expect(page).not.toContain('Shift Swap');
    expect(page).not.toContain('Secure Vault Access');
    expect(page).toContain('ด่วนที่สุด (Urgent)');
    expect(page).toContain('ปกติ (Standard)');
    expect(page).toContain('ผู้ส่งคำขอ / ผู้ปฏิบัติงาน');
    expect(page).toContain('pendingAge(item.ageHours)');
    expect(page).toContain('fmt(item.submittedAt)');
    expect(page).toContain('รายละเอียด / ดำเนินการ');
    expect(page).toContain('summary.total');
    expect(page).toContain('overflow-x-hidden');
    expect(page).toContain('aria-pressed={selected?.id === item.id}');
    expect(css).toContain('.nexus-approval-select:focus-visible{border:0!important');
    expect(page).not.toContain('backend ยังคงตรวจสอบสิทธิ์อีกชั้นหนึ่ง');
    expect(main).toContain("{ id: 'leavePending', icon: 'approval', label: 'อนุมัติคำขอลา' }");
    expect(main).toContain("setActivePage(canManage ? 'approvalCenter' : 'leave')");
    expect(css).toContain('.nexus-approval-center{background:#020813!important');
  });

  it('keeps request UUIDs internal while showing an icon and the submitter in both queue layouts', () => {
    expect(page).not.toContain('{item.requestId}');
    expect(page).not.toContain('{rejecting.requestId}');
    expect(page).toContain('<SmsIcon name="users" size={17}');
    expect(page).toContain('<SmsIcon name="users" size={18}');
    expect(page).toContain('ผู้ส่ง: {senderName(item)}');
    expect(page).toContain('senderRoleName(item.requestedBy.role)');
  });
});
