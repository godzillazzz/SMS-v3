import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { approvalActionPresentation, approvalStatusPresentation } from './approval-workflow-semantics';

const actionCss = fs.readFileSync(path.join(__dirname, 'styles/action-system.css'), 'utf8');

describe('Approval Workflow Standard V1 shared UI semantics', () => {
  it('maps locked Thai reviewer/requester actions to shared semantic classes', () => {
    expect(approvalActionPresentation('APPROVE')).toEqual({ label: 'อนุมัติ', className: 'btn-approve', tone: 'success' });
    expect(approvalActionPresentation('RETURN_FOR_CORRECTION')).toEqual({ label: 'ส่งกลับไปแก้ไข', className: 'btn-return', tone: 'warning' });
    expect(approvalActionPresentation('REJECT')).toEqual({ label: 'ไม่อนุมัติ', className: 'btn-reject', tone: 'danger' });
    expect(approvalActionPresentation('RESUBMIT')).toEqual({ label: 'ส่งตรวจสอบอีกครั้ง', className: 'btn-resubmit', tone: 'primary' });
    expect(approvalActionPresentation('CANCEL')).toEqual({ label: 'ยกเลิกคำขอ', className: 'btn-cancel', tone: 'danger' });
  });

  it('provides normalized status semantics including returned and cancelled', () => {
    expect(approvalStatusPresentation('DRAFT').className).toBe('status-draft');
    expect(approvalStatusPresentation('PENDING_APPROVAL').className).toBe('status-pending');
    expect(approvalStatusPresentation('RETURNED_FOR_CORRECTION').className).toBe('status-returned');
    expect(approvalStatusPresentation('APPROVED').className).toBe('status-approved');
    expect(approvalStatusPresentation('REJECTED').className).toBe('status-rejected');
    expect(approvalStatusPresentation('CANCELLED').className).toBe('status-cancelled');
  });

  it('keeps semantic aliases on the existing action system with focus and disabled states', () => {
    ['btn-approve', 'btn-return', 'btn-reject', 'btn-resubmit', 'btn-cancel', 'btn-save-draft'].forEach((name) => expect(actionCss).toContain(name));
    expect(actionCss).toMatch(/button\.btn-approve[\s\S]*var\(--action-success\)/);
    expect(actionCss).toMatch(/button\.btn-return[\s\S]*var\(--action-warning\)/);
    expect(actionCss).toMatch(/button\.btn-reject[\s\S]*var\(--action-danger\)/);
    expect(actionCss).toMatch(/button\.btn-resubmit[\s\S]*var\(--action-primary\)/);
    expect(actionCss).toMatch(/button\.btn-cancel[\s\S]*var\(--action-danger\)/);
    expect(actionCss).toContain('button.btn-approve:focus-visible');
    expect(actionCss).toContain('button.btn-return:focus-visible');
    expect(actionCss).toContain('button.btn-reject:disabled');
    expect(actionCss).toContain('button.btn-cancel:disabled');
  });
});