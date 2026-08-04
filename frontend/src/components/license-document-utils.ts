import { formatThaiDate, formatThaiDateTime } from '../utils/date-format';
export type LicenseDocumentStatus = 'PENDING' | 'RETURNED_FOR_CORRECTION' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED' | 'EXPIRED';

export const MAX_LICENSE_DOCUMENT_BYTES = 2 * 1024 * 1024;

export type LicenseDocument = {
  id: string;
  employeeId: string;
  licenseId: string;
  safeDisplayFileName: string;
  mimeType: string;
  fileSize: number;
  proposedStartDate: string;
  proposedExpiryDate: string;
  proposedLicenseNumber?: string | null;
  status: LicenseDocumentStatus;
  isCurrent: boolean;
  uploadedAt: string;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  correctionReason?: string | null;
  returnedAt?: string | null;
  resubmittedAt?: string | null;
  immediateDeletionRequestedAt?: string | null;
  expirationProcessedAt?: string | null;
  version: number;
  note?: string | null;
  fileAvailable?: boolean;
  storageDeletedAt?: string | null;
  storageDeleteAfter?: string | null;
  uploadedBy?: { id: string; displayName: string } | null;
  reviewedBy?: { id: string; displayName: string } | null;
  returnedBy?: { id: string; displayName: string } | null;
};

export const licenseDocumentStatusLabel: Record<LicenseDocumentStatus, string> = {
  PENDING: 'รอตรวจสอบ',
  RETURNED_FOR_CORRECTION: 'ส่งกลับแก้ไข',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  SUPERSEDED: 'ถูกแทนที่แล้ว',
  EXPIRED: 'หมดอายุ'
};

export function sortLicenseDocuments(documents: LicenseDocument[]) {
  return [...documents].sort((left, right) => {
    const versionDifference = Number(right.version) - Number(left.version);
    if (versionDifference) return versionDifference;
    return new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime();
  });
}

export function selectLicenseDocumentSummary(documents: LicenseDocument[]) {
  const sorted = sortLicenseDocuments(documents);
  const returned = sorted.filter((item) => {
    if (item.status !== 'RETURNED_FOR_CORRECTION' || item.resubmittedAt) return false;
    return !sorted.some((newer) => {
      if (newer.id === item.id || !['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED'].includes(newer.status)) return false;
      if (Number(newer.version) > Number(item.version)) return true;
      if (Number(newer.version) < Number(item.version)) return false;
      return new Date(newer.uploadedAt).getTime() > new Date(item.uploadedAt).getTime();
    });
  }).slice(0, 1);
  return {
    current: sorted.find((item) => item.status === 'APPROVED' && item.isCurrent),
    pending: sorted.filter((item) => item.status === 'PENDING'),
    returned,
    latestRejected: sorted.find((item) => item.status === 'REJECTED'),
    latestExpired: sorted.find((item) => item.status === 'EXPIRED')
  };
}

export function canPermanentlyDeleteDocument(document: LicenseDocument, documents: LicenseDocument[]) {
  if (!['RETURNED_FOR_CORRECTION', 'REJECTED', 'SUPERSEDED'].includes(document.status)) return false;
  if (document.status === 'RETURNED_FOR_CORRECTION' && selectLicenseDocumentSummary(documents).returned.some((item) => item.id === document.id)) return false;
  if (document.status === 'SUPERSEDED' && !documents.some((item) => item.status === 'APPROVED' && item.isCurrent)) return false;
  return true;
}

export function selectLicenseDocumentForTable(documents: LicenseDocument[]) {
  const summary = selectLicenseDocumentSummary(documents);
  if (summary.current) return summary.current;
  return summary.pending.find((item) => item.fileAvailable !== false)
    || summary.returned.find((item) => item.fileAvailable !== false)
    || (summary.latestRejected?.fileAvailable !== false ? summary.latestRejected : undefined);
}

export function licenseTableStatus(documents: LicenseDocument[], issueDate?: string | null, expiryDate?: string | null, status?: string | null, now = new Date()) {
  const summary = selectLicenseDocumentSummary(documents);
  if (summary.pending.length && summary.current) return { label: 'มีรายการรอตรวจสอบ', tone: 'pending' as const };
  if (summary.returned.length && summary.current) return { label: 'มีรายการส่งกลับแก้ไข', tone: 'returned' as const };
  if (summary.current) {
    const validity = licenseValidityLabel(issueDate, expiryDate, status, now);
    if (validity === 'หมดอายุ') return { label: 'หมดอายุ', tone: 'expired' as const };
    if (validity === 'ใกล้หมดอายุ') return { label: 'ใกล้หมดอายุ', tone: 'expiring' as const };
    return { label: 'อนุมัติแล้ว', tone: 'approved' as const };
  }
  if (summary.pending.length) return { label: 'รอตรวจสอบ', tone: 'pending' as const };
  if (summary.returned.length) return { label: 'ส่งกลับแก้ไข', tone: 'returned' as const };
  if (summary.latestRejected) return { label: 'ไม่อนุมัติ', tone: 'rejected' as const };
  if (summary.latestExpired) return { label: 'หมดอายุ', tone: 'expired' as const };
  return { label: 'ยังไม่มีเอกสาร', tone: 'empty' as const };
}

export function formatLicenseDate(value?: string | null) {
  return formatThaiDate(value, { month: 'short' });
}

export function formatLicenseDateTime(value?: string | null) {
  return formatThaiDateTime(value);
}

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function licenseValidityLabel(issueDate?: string | null, expiryDate?: string | null, status?: string | null, now = new Date()) {
  if (!['active', 'valid'].includes(String(status || '').trim().toLowerCase())) return status || 'ไม่พร้อมใช้งาน';
  const issue = String(issueDate || '').slice(0, 10);
  const expiry = String(expiryDate || '').slice(0, 10);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = /^\d{4}-\d{2}-\d{2}$/.test(issue) ? new Date(`${issue}T00:00:00Z`) : null;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? new Date(`${expiry}T00:00:00Z`) : null;
  if (!start || !end || start > today) return 'ไม่พร้อมใช้งาน';
  if (end < today) return 'หมดอายุ';
  const warningDate = new Date(today); warningDate.setUTCDate(warningDate.getUTCDate() + 60);
  return end <= warningDate ? 'ใกล้หมดอายุ' : 'ปกติ';
}

export function sanitizeLicenseDocumentError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  const status = typeof reason === 'object' && reason !== null && 'status' in reason && typeof reason.status === 'number' ? reason.status : 0;
  const requestId = typeof reason === 'object' && reason !== null && 'requestId' in reason && typeof reason.requestId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(reason.requestId) ? reason.requestId : '';
  if (!message || /https?:\/\/|signed.?url|storage|object.?key|stack|prisma|database|internal|credential|token/i.test(message)) {
    return `ระบบไม่สามารถดำเนินการเอกสารได้ชั่วคราว กรุณาลองใหม่อีกครั้ง${status >= 500 && requestId ? ` (รหัสอ้างอิง: ${requestId})` : ''}`;
  }
  return message.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 300);
}
