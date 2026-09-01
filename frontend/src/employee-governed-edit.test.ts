import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const editor = read('components/personnel/EmployeeGovernedEditModal.tsx');
const review = read('components/personnel/EmployeeChangeReviewModal.tsx');
const main = read('main.tsx');
const page = read('pages/personnel/PersonnelDirectoryPage.tsx');
const header = read('components/personnel/PersonnelDirectoryHeader.tsx');
const api = read('api.ts');
const css = read('styles/employee-governed-edit.css');
const approvalSemantics = read('approval-workflow-semantics.ts');

function managerOnlySource() {
  const start = editor.indexOf("const operationalFields =");
  const end = editor.indexOf("const adminFields =", start);
  return editor.slice(start, end);
}

describe('Employee Master Governed Edit V1 frontend contracts', () => {
  it('wires existing Employee edit action to the governed modal instead of a parallel page', () => {
    expect(main).toContain("setEmployeeGovernedEditTarget(employee)");
    expect(main).toContain('<EmployeeGovernedEditModal');
    expect(page).toContain('onEdit={onEdit}');
    expect(main).not.toContain("setActivePage('employeeGovernedEdit')");
  });

  it('opening an existing Employee editor never creates a DRAFT', () => {
    const openBlock = main.slice(main.indexOf('const openEmployeeEditor'), main.indexOf('const [shiftEditorTarget'));
    expect(openBlock).toContain('setEmployeeGovernedEditTarget(employee)');
    expect(openBlock).not.toContain('createEmployeeChangeDraft');
    expect(editor.indexOf('api.employeeChangeRequests')).toBeLessThan(editor.indexOf('const submitManager'));
    expect(editor.slice(0, editor.indexOf('const submitManager'))).not.toContain('api.createEmployeeChangeDraft');
  });

  it('Admin uses authoritative master preflight/save and does not create an EmployeeChangeRequest', () => {
    const adminSave = editor.slice(editor.indexOf('const runPreflight'), editor.indexOf('const submitManager'));
    expect(adminSave).toContain('api.preflightEmployeeMasterEdit');
    expect(adminSave).toContain('api.updateEmployee');
    expect(adminSave).not.toContain('createEmployeeChangeDraft');
    expect(adminSave).not.toContain('submitEmployeeChangeRequest');
    expect(editor).toContain('บันทึกการแก้ไข');
  });

  it('Manager uses governed request actions and never renders an authoritative Save CTA', () => {
    const manager = editor.slice(editor.indexOf('const submitManager'));
    expect(manager).toContain('api.createEmployeeChangeDraft');
    expect(manager).toContain('api.submitEmployeeChangeRequest');
    expect(manager).toContain('api.resubmitEmployeeChangeRequest');
    expect(manager).toContain('api.cancelEmployeeChangeRequest');
    expect(editor).toContain('ส่งคำขอแก้ไข');
    expect(editor).toContain("approvalActionPresentation('RESUBMIT')");
    expect(editor).toContain('resubmitAction.label');
    expect(approvalSemantics).toContain("label: 'ส่งตรวจสอบอีกครั้ง'");
    expect(editor).not.toContain('Manager Save authoritative');
  });

  it('Manager field authority excludes email phone hiredAt and skill', () => {
    const scope = managerOnlySource();
    expect(scope).toContain("'employeeCode'");
    expect(scope).toContain("'firstName'");
    expect(scope).toContain("'lastName'");
    expect(scope).toContain("'department'");
    expect(scope).toContain("'jobTitle'");
    expect(scope).toContain("'isActive'");
    for (const pii of ["'email'", "'phone'", "'hiredAt'", "'skill'"]) expect(scope).not.toContain(pii);
    expect(editor).toContain('{isAdmin && <>');
  });

  it('General Information renders governed identity and employment chronology as read-only', () => {
    expect(editor).toContain(`value={String(employee.employeeCode || '')} readOnly aria-readonly="true"`);
    expect(editor).toContain(`value={String(employee.firstName || '')} readOnly aria-readonly="true"`);
    expect(editor).toContain(`value={String(employee.lastName || '')} readOnly aria-readonly="true"`);
    expect(editor).toContain(`value={String(employee.department || '')} readOnly aria-readonly="true"`);
    expect(editor).toContain(`value={String(employee.jobTitle || '')} readOnly aria-readonly="true"`);
    expect(editor).toContain('value={cleanDate(employee.hiredAt)} readOnly aria-readonly="true"');
    expect(editor).not.toContain("update('employeeCode'");
    expect(editor).not.toContain("update('hiredAt'");
    expect(editor).toContain('ใช้ “เปลี่ยนชื่อ”');
    expect(editor).toContain('ใช้ “ย้ายหน่วยงาน”');
    expect(editor).toContain('ใช้ “เปลี่ยนตำแหน่ง”');
  });

  it('PENDING proposal is read-only while cancellation remains available', () => {
    expect(editor).toContain("activeRequest?.status === 'PENDING_APPROVAL'");
    expect(editor).toContain('disabled={pendingReadOnly}');
    expect(editor).toContain("activeRequest && activeStatuses.has(activeRequest.status)");
    expect(editor).toContain('ยกเลิกคำขอ');
    expect(editor).toContain('{!pendingReadOnly && <button');
  });

  it('RETURNED flow shows reviewer comment, current authoritative context, and resubmits Revision N+1 intent', () => {
    expect(editor).toContain('activeRequest.lastReviewerComment');
    expect(editor).toContain('ข้อมูล Employee Master ปัจจุบัน');
    expect(editor).toContain("['DRAFT', 'PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION'].includes(active.status)");
    expect(editor).toContain('api.resubmitEmployeeChangeRequest');
    expect(editor).toContain('Revision ก่อนหน้ายังคงไม่เปลี่ยนแปลง');
  });

  it('Admin review queue is wired from Personnel header and defaults to the server actionable queue', () => {
    expect(header).toContain('คำขอแก้ไข');
    expect(page).toContain("canReviewChanges={role === 'ADMIN'}");
    expect(main).toContain('setEmployeeChangeReviewOpen(true)');
    expect(review).toContain('api.employeeChangeRequestQueue(token)');
    expect(api).toContain('employeeChangeRequestQueue');
    expect(review).toContain('PENDING_APPROVAL');
  });

  it('Admin review presents identity requester role timestamp revision status effective timing reason and impact', () => {
    for (const marker of ['requestOwnerRoleSnapshot', 'Revision {revision.revision}', 'selected.status', 'revision.effectiveMode', 'revision.effectiveDate', 'revision.reason', 'futureShiftAssignments', 'pendingLeaveRequests', 'approvedFutureLeaveRequests', 'activeLicenses']) {
      expect(review).toContain(marker);
    }
  });

  it('Admin review shows changed-fields BEFORE to AFTER and no editable proposal fields', () => {
    expect(review).toContain('BEFORE');
    expect(review).toContain('AFTER');
    expect(review).toContain('revision.changedFields.map');
    expect(review).toContain('revision.beforeSnapshot[field]');
    expect(review).toContain('revision.afterSnapshot[field]');
  });

  it('Return and Reject require comments while Approve is distinct', () => {
    expect(review).toContain("action !== 'approve' && reviewComment.trim().length < 3");
    expect(review).toContain("approvalActionPresentation('RETURN_FOR_CORRECTION')");
    expect(review).toContain("approvalActionPresentation('REJECT')");
    expect(review).toContain("approvalActionPresentation('APPROVE')");
    expect(review).toContain('returnAction.label');
    expect(review).toContain('rejectAction.label');
    expect(review).toContain('approveAction.label');
    expect(approvalSemantics).toContain("label: 'ส่งกลับไปแก้ไข'");
    expect(approvalSemantics).toContain("label: 'ไม่อนุมัติ'");
    expect(approvalSemantics).toContain("label: 'อนุมัติ'");
    expect(review).toContain("api.returnEmployeeChangeRequest");
    expect(review).toContain("api.rejectEmployeeChangeRequest");
    expect(review).toContain("api.approveEmployeeChangeRequest");
  });

  it('stale conflict shows Owner-locked Thai UX and never auto-retries approval', () => {
    expect(review).toContain('EMPLOYEE_CHANGE_STALE_MASTER');
    expect(review).toContain('ข้อมูล Employee Master มีการเปลี่ยนแปลงหลังจากส่งคำขอ');
    expect(review).toContain('โปรดส่งกลับให้ผู้ขอทบทวนข้อมูลล่าสุด');
    const catchBlock = review.slice(review.indexOf("if (code === 'EMPLOYEE_CHANGE_STALE_MASTER')"), review.indexOf('finally', review.indexOf("if (code === 'EMPLOYEE_CHANGE_STALE_MASTER')")));
    expect(catchBlock).not.toContain('approveEmployeeChangeRequest(');
  });

  it('future-effective approved request is shown as approved but waiting for effective date', () => {
    expect(editor).toContain('อนุมัติแล้ว · รอวันที่มีผล');
    expect(editor).toContain("effectiveMode === 'FUTURE_EFFECTIVE'");
    expect(editor).toContain('effectiveDate');
  });

  it('impact preflight and warning acknowledgement are present for Admin', () => {
    expect(editor).toContain('preflight.impacts.futureShiftAssignments');
    expect(editor).toContain('preflight.impacts.pendingLeaveRequests');
    expect(editor).toContain('preflight.impacts.approvedFutureLeaveRequests');
    expect(editor).toContain('preflight.impacts.activeLicenses');
    expect(editor).toContain('acknowledgeWarnings');
  });

  it('revision and terminal histories render as cards rather than a squeezed table', () => {
    expect(editor).toContain('employee-revision-list');
    expect(editor).toContain('history.map');
    expect(editor).toContain('statusLabel[request.status]');
    expect(css).toContain('.employee-revision-list article');
    expect(editor).not.toContain('<table');
  });

  it('both viewport-level surfaces portal to document.body and use shared reference-counted scroll lock', () => {
    for (const source of [editor, review]) {
      expect(source).toContain('createPortal');
      expect(source).toContain('document.body');
      expect(source).toContain('acquireDocumentScrollLock()');
      expect(source).toContain('release()');
    }
    expect(main).toContain("if (activePage !== 'employees')");
    expect(main).toContain('setEmployeeGovernedEditTarget(undefined)');
    expect(main).toContain('setEmployeeChangeReviewOpen(false)');
  });

  it('mobile CSS keeps modal foreground in viewport with vertical scrolling and card layouts', () => {
    expect(css).toContain('max-height:92dvh');
    expect(css).toContain('overflow:auto');
    expect(css).toContain('@media(max-width:760px)');
    expect(css).toContain('width:100vw');
    expect(css).toContain('align-items:flex-end');
    expect(css).toContain('.employee-review-layout{display:flex;flex-direction:column;overflow:auto}');
  });
});
