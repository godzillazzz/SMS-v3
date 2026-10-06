type ScheduleApprovalRowState = {
  status?: unknown;
  isLatestRevision?: unknown;
};

const statusLabels: Record<string, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  DRAFT: 'ฉบับร่าง',
  CANCELLED: 'ยกเลิก',
  SUPERSEDED: 'ถูกแทนที่'
};

const changeTypeLabels: Record<string, string> = {
  BATCH_UPDATE_SHIFT: 'แก้ไขกะหลายรายการ',
  AUTO_SCHEDULE_EMPLOYEE: 'จัดกะอัตโนมัติ',
  LICENSE_RECONCILIATION: 'ปรับตามใบอนุญาต',
  PRODUCTION_SHIFT_TIME_NORMALIZATION: 'ปรับรูปแบบเวลากะ'
};

const errorMessages: Record<string, string> = {
  SCHEDULE_APPROVAL_INVALID_STATE: 'รายการอนุมัติไม่อยู่ในสถานะรออนุมัติ จึงดำเนินการต่อไม่ได้',
  SCHEDULE_APPROVAL_SUPERSEDED: 'รายการนี้ถูกแทนที่ด้วย revision ที่ใหม่กว่า จึงดำเนินการต่อไม่ได้',
  SCHEDULE_REJECTION_REASON_REQUIRED: 'กรุณาระบุเหตุผลการไม่อนุมัติอย่างน้อย 5 ตัวอักษร'
};

function normalizedCode(value: unknown) {
  return String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

export function isSupersededScheduleApproval(row: ScheduleApprovalRowState) {
  const status = normalizedCode(row.status);
  return status === 'SUPERSEDED' || (status === 'PENDING' && row.isLatestRevision === false);
}

export function canDecideScheduleApproval(row: ScheduleApprovalRowState) {
  return normalizedCode(row.status) === 'PENDING' && row.isLatestRevision === true;
}

export function scheduleApprovalStatusLabel(value: unknown, superseded = false) {
  if (superseded) return statusLabels.SUPERSEDED;
  return statusLabels[normalizedCode(value)] || 'อื่น ๆ';
}

export function scheduleApprovalTone(value: unknown) {
  const status = normalizedCode(value);
  if (status === 'APPROVED') return 'success';
  if (status === 'PENDING') return 'warning';
  if (status === 'REJECTED') return 'danger';
  if (['DRAFT', 'CANCELLED', 'SUPERSEDED'].includes(status)) return 'neutral';
  return undefined;
}

export function scheduleApprovalChangeTypeLabel(value: unknown) {
  return changeTypeLabels[normalizedCode(value)] || 'อื่น ๆ';
}

export function scheduleApprovalErrorMessage(code: unknown) {
  return errorMessages[String(code ?? '').trim()] || undefined;
}
