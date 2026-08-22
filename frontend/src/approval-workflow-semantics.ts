export type ApprovalTransition = 'SAVE_DRAFT' | 'SUBMIT' | 'RETURN_FOR_CORRECTION' | 'RESUBMIT' | 'APPROVE' | 'REJECT' | 'CANCEL';
export type ApprovalStatus = 'DRAFT' | 'PENDING' | 'PENDING_APPROVAL' | 'RETURNED_FOR_CORRECTION' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type ApprovalTone = 'neutral' | 'warning' | 'success' | 'danger' | 'primary';

export const approvalActionUi: Record<ApprovalTransition, { label: string; className: string; tone: ApprovalTone }> = {
  SAVE_DRAFT: { label: 'บันทึกร่าง', className: 'btn-save-draft', tone: 'primary' },
  SUBMIT: { label: 'ส่งตรวจสอบ', className: 'btn-resubmit', tone: 'primary' },
  RETURN_FOR_CORRECTION: { label: 'ส่งกลับไปแก้ไข', className: 'btn-return', tone: 'warning' },
  RESUBMIT: { label: 'ส่งตรวจสอบอีกครั้ง', className: 'btn-resubmit', tone: 'primary' },
  APPROVE: { label: 'อนุมัติ', className: 'btn-approve', tone: 'success' },
  REJECT: { label: 'ไม่อนุมัติ', className: 'btn-reject', tone: 'danger' },
  CANCEL: { label: 'ยกเลิกคำขอ', className: 'btn-cancel', tone: 'danger' }
};

export const approvalStatusUi: Record<ApprovalStatus, { label: string; className: string; tone: ApprovalTone }> = {
  DRAFT: { label: 'ฉบับร่าง', className: 'status-draft', tone: 'neutral' },
  PENDING: { label: 'รอตรวจสอบ', className: 'status-pending', tone: 'warning' },
  PENDING_APPROVAL: { label: 'รอตรวจสอบ', className: 'status-pending', tone: 'warning' },
  RETURNED_FOR_CORRECTION: { label: 'ส่งกลับไปแก้ไข', className: 'status-returned', tone: 'warning' },
  APPROVED: { label: 'อนุมัติแล้ว', className: 'status-approved', tone: 'success' },
  REJECTED: { label: 'ไม่อนุมัติ', className: 'status-rejected', tone: 'danger' },
  CANCELLED: { label: 'ยกเลิกคำขอ', className: 'status-cancelled', tone: 'danger' }
};

export function approvalActionPresentation(transition: ApprovalTransition) {
  return approvalActionUi[transition];
}

export function approvalStatusPresentation(status: ApprovalStatus) {
  return approvalStatusUi[status];
}