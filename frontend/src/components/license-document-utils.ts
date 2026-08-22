import { approvalStatusUi } from '../approval-workflow-semantics';

export type LicenseDocumentStatus = 'PENDING' | 'RETURNED_FOR_CORRECTION' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'SUPERSEDED' | 'EXPIRED';

export const MAX_LICENSE_DOCUMENT_BYTES = 4 * 1024 * 1024;

export type LicenseDocumentRevision = {
  id: string;
  documentId: string;
  revision: number;
  safeDisplayFileName: string;
  mimeType: string;
  fileSize: number;
  proposedStartDate: string;
  proposedExpiryDate: string;
  proposedLicenseNumber?: string | null;
  note?: string | null;
  correctionReason?: string | null;
  submittedAt: string;
  submittedBy?: { id: string; displayName: string } | null;
};
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
  revisions?: LicenseDocumentRevision[];
};

export const licenseDocumentStatusLabel: Record<LicenseDocumentStatus, string> = {
  PENDING: approvalStatusUi.PENDING.label,
  RETURNED_FOR_CORRECTION: approvalStatusUi.RETURNED_FOR_CORRECTION.label,
  APPROVED: approvalStatusUi.APPROVED.label,
  REJECTED: approvalStatusUi.REJECTED.label,
  CANCELLED: approvalStatusUi.CANCELLED.label,
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
      if (newer.id === item.id || !['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'].includes(newer.status)) return false;
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
    latestCancelled: sorted.find((item) => item.status === 'CANCELLED'),
    latestExpired: sorted.find((item) => item.status === 'EXPIRED')
  };
}

export function canPermanentlyDeleteDocument(document: LicenseDocument, documents: LicenseDocument[]) {
  if (!['RETURNED_FOR_CORRECTION', 'REJECTED', 'CANCELLED', 'SUPERSEDED'].includes(document.status)) return false;
  if (document.status === 'RETURNED_FOR_CORRECTION' && selectLicenseDocumentSummary(documents).returned.some((item) => item.id === document.id)) return false;
  if (document.status === 'SUPERSEDED' && !documents.some((item) => item.status === 'APPROVED' && item.isCurrent)) return false;
  return true;
}

export function selectLicenseDocumentForTable(documents: LicenseDocument[]) {
  const summary = selectLicenseDocumentSummary(documents);
  if (summary.current) return summary.current;
  return summary.pending.find((item) => item.fileAvailable !== false)
    || summary.returned.find((item) => item.fileAvailable !== false)
    || (summary.latestCancelled?.fileAvailable !== false ? summary.latestCancelled : undefined)
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
  if (summary.latestCancelled) return { label: approvalStatusUi.CANCELLED.label, tone: 'cancelled' as const };
  if (summary.latestRejected) return { label: approvalStatusUi.REJECTED.label, tone: 'rejected' as const };
  if (summary.latestExpired) return { label: 'หมดอายุ', tone: 'expired' as const };
  return { label: 'ยังไม่มีเอกสาร', tone: 'empty' as const };
}

export function formatLicenseDate(value?: string | null) {
  if (!value) return '-';
  const dateOnly = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) return '-';
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed);
}

export function formatLicenseDateTime(value?: string | null) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(parsed);
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
  if (!message || /https?:\/\/|signed.?url|storage|object.?key|stack|prisma|database|internal|credential|token/i.test(message)) {
    return 'ระบบไม่สามารถดำเนินการเอกสารได้ชั่วคราว กรุณาลองใหม่อีกครั้ง';
  }
  return message.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 300);
}
