import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { api } from './api';
import { ATTACHMENT_POLICIES, PDF_HARD_LIMIT_BYTES } from './lib/attachment-optimizer';
import {
  LicenseDocument,
  licenseValidityLabel,
  licenseDocumentStatusLabel,
  sanitizeLicenseDocumentError,
  licenseTableStatus,
  selectLicenseDocumentForTable,
  selectLicenseDocumentSummary,
  sortLicenseDocuments
} from './components/license-document-utils';

const componentSource = fs.readFileSync(path.join(__dirname, 'components', 'LicenseDocuments.tsx'), 'utf-8');
const mainSource = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf-8');
const styleSource = fs.readFileSync(path.join(__dirname, 'styles', 'license-documents.css'), 'utf-8');
const dataSurfaceStyleSource = fs.readFileSync(path.join(__dirname, 'styles', 'data-surfaces.css'), 'utf-8');
const actionStyleSource = fs.readFileSync(path.join(__dirname, 'styles', 'action-system.css'), 'utf-8');

const documentRow = (overrides: Partial<LicenseDocument> = {}): LicenseDocument => ({
  id: 'doc-1', employeeId: 'emp-1', licenseId: 'license-1', safeDisplayFileName: 'license.pdf', mimeType: 'application/pdf', fileSize: 1000,
  proposedStartDate: '2026-01-01', proposedExpiryDate: '2027-01-01', status: 'PENDING', isCurrent: false, uploadedAt: '2026-07-31T08:00:00Z', version: 1,
  uploadedBy: { id: 'admin-1', displayName: 'Admin One' }, ...overrides
});

afterEach(() => vi.unstubAllGlobals());

describe('license document table state', () => {
  it('keeps document management out of the table and puts the view column between status and actions', () => {
    expect(mainSource).not.toContain('LicenseDocumentsCell');
    expect(mainSource).toContain('LicenseTableDocumentColumns');
    expect(mainSource.indexOf("{ label: 'สถานะ'"))
      .toBeLessThan(mainSource.indexOf("{ label: 'ดูไฟล์'"));
    expect(mainSource).toContain("if (column.label === 'ดูไฟล์') return null;");
  });

  it('uses the required eye label without personal data and keeps role-specific actions', () => {
    expect(componentSource).toContain('aria-label="ดูไฟล์ใบอนุญาต"');
    expect(componentSource).not.toMatch(/aria-label=\{`ดูไฟล์/);
    expect(mainSource).toContain("role === 'ADMIN' && <DataRowActionMenu");
    expect(mainSource).toContain("label: 'ลบใบอนุญาต'");
    expect(mainSource).toContain("onSelect: () => onAction(row, 'delete')");
    expect(mainSource).toContain("page === 'licenses' ? renderLicenseCell");
  });

  it('selects the approved current file before pending renewals', () => {
    const current = documentRow({ id: 'approved', status: 'APPROVED', isCurrent: true, version: 2 });
    const renewal = documentRow({ id: 'pending', status: 'PENDING', version: 3 });
    expect(selectLicenseDocumentForTable([renewal, current])?.id).toBe('approved');
    expect(licenseTableStatus([renewal, current]).label).toBe('มีรายการรอตรวจสอบ');
  });

  it('selects pending, cancelled, or rejected files only when no current file exists', () => {
    const pending = documentRow({ id: 'pending', status: 'PENDING', version: 3 });
    const cancelled = documentRow({ id: 'cancelled', status: 'CANCELLED', version: 2 });
    const rejected = documentRow({ id: 'rejected', status: 'REJECTED', version: 1 });
    expect(selectLicenseDocumentForTable([pending])?.id).toBe('pending');
    expect(selectLicenseDocumentForTable([cancelled])?.id).toBe('cancelled');
    expect(selectLicenseDocumentForTable([rejected])?.id).toBe('rejected');
    expect(licenseTableStatus([cancelled]).label).toBe('ยกเลิกคำขอ');
    expect(selectLicenseDocumentForTable([])).toBeUndefined();
  });

  it('does not make a retention-deleted file clickable', () => {
    const deleted = documentRow({ status: 'APPROVED', isCurrent: true, storageDeletedAt: '2026-08-01T00:00:00Z' });
    expect(selectLicenseDocumentForTable([deleted])?.storageDeletedAt).toBeTruthy();
    expect(componentSource).toContain('ไฟล์ต้นฉบับถูกลบตามนโยบายจัดเก็บข้อมูล');
  });

  it('supports the shared pending, returned, approved, rejected, and cancelled Thai status semantics', () => {
    expect(componentSource).toContain('licenseDocumentStatusLabel[document.status]');
    expect(licenseDocumentStatusLabel.PENDING).toBe('รอตรวจสอบ');
    expect(licenseDocumentStatusLabel.RETURNED_FOR_CORRECTION).toBe('ส่งกลับไปแก้ไข');
    expect(licenseDocumentStatusLabel.APPROVED).toBe('อนุมัติแล้ว');
    expect(licenseDocumentStatusLabel.REJECTED).toBe('ไม่อนุมัติ');
    expect(licenseDocumentStatusLabel.CANCELLED).toBe('ยกเลิกคำขอ');
  });

  it('keeps returned/cancelled shared wording and legacy superseded/expired wording distinct', () => {
    expect(licenseDocumentStatusLabel.RETURNED_FOR_CORRECTION).toBe('ส่งกลับไปแก้ไข');
    expect(licenseDocumentStatusLabel.CANCELLED).toBe('ยกเลิกคำขอ');
    expect(licenseDocumentStatusLabel.SUPERSEDED).toBeTruthy();
    expect(licenseDocumentStatusLabel.EXPIRED).toBeTruthy();
    expect(componentSource).toContain('status-cancelled');
  });

  it('keeps an approved current document and pending renewal visible together', () => {
    const current = documentRow({ id: 'approved', status: 'APPROVED', isCurrent: true, version: 2 });
    const renewal = documentRow({ id: 'pending', status: 'PENDING', version: 3 });
    const summary = selectLicenseDocumentSummary([current, renewal]);
    expect(summary.current?.id).toBe('approved');
    expect(summary.pending.map((item) => item.id)).toEqual(['pending']);
    expect(componentSource).toContain('ฉบับต่ออายุรอตรวจสอบ');
  });

  it('hides a returned record when a newer pending document exists', () => {
    const returned = documentRow({ id: 'returned', status: 'RETURNED_FOR_CORRECTION', version: 2, correctionReason: 'แก้วันที่' });
    const pending = documentRow({ id: 'pending-new', status: 'PENDING', version: 3 });
    const summary = selectLicenseDocumentSummary([returned, pending]);
    expect(summary.returned).toEqual([]);
    expect(licenseTableStatus([returned, pending]).label).toBe('รอตรวจสอบ');
  });

  it('keeps an older returned record in history while an approved replacement is current', () => {
    const returned = documentRow({ id: 'returned', status: 'RETURNED_FOR_CORRECTION', version: 2 });
    const approved = documentRow({ id: 'approved-new', status: 'APPROVED', isCurrent: true, version: 3 });
    const summary = selectLicenseDocumentSummary([returned, approved]);
    expect(summary.returned).toEqual([]);
    expect(sortLicenseDocuments([returned, approved]).map((item) => item.id)).toEqual(['approved-new', 'returned']);
  });

  it('keeps approved current data while exposing returned correction only to the uploadedBy owner', () => {
    const current = documentRow({ id: 'approved', status: 'APPROVED', isCurrent: true, version: 2 });
    const returned = documentRow({ id: 'returned', status: 'RETURNED_FOR_CORRECTION', version: 3, correctionReason: 'แก้วันที่', uploadedBy: { id: 'manager-owner', displayName: 'Manager Owner' } });
    const summary = selectLicenseDocumentSummary([current, returned]);
    expect(summary.current?.id).toBe('approved');
    expect(summary.returned.map((item) => item.id)).toEqual(['returned']);
    expect(componentSource).toContain('document.uploadedBy?.id === currentUserId');
    expect(componentSource).toContain('แก้ไข / ส่งตรวจสอบอีกครั้ง');
    expect(mainSource).toContain("currentUserId={auth.user?.id || ''}");
  });

  it('uses the existing 60-day warning rule without timezone shifting date-only values', () => {
    const now = new Date('2026-07-31T18:00:00Z');
    expect(licenseValidityLabel('2026-01-01', '2026-07-30', 'Active', now)).toBe('หมดอายุ');
    expect(licenseValidityLabel('2026-01-01', '2026-08-15', 'Active', now)).toBe('ใกล้หมดอายุ');
    expect(licenseValidityLabel('2026-01-01', '2027-01-01', 'Active', now)).toBe('ปกติ');
  });

  it('uses the shared Attachment Optimizer V1 document contract in the modal', () => {
    expect(ATTACHMENT_POLICIES.DOCUMENT.targetMinBytes).toBe(300 * 1024);
    expect(ATTACHMENT_POLICIES.DOCUMENT.targetMaxBytes).toBe(450 * 1024);
    expect(ATTACHMENT_POLICIES.DOCUMENT.hardLimitBytes).toBe(500 * 1024);
    expect(PDF_HARD_LIMIT_BYTES).toBe(1024 * 1024);
    expect(componentSource).toContain('ระบบปรับขนาดอัตโนมัติ');
    expect(componentSource).toContain('สูงสุด 500 KB');
    expect(componentSource).toContain('PDF สูงสุด 1 MB');
    expect(componentSource).not.toContain('ขนาดไม่เกิน 4 MB');
    expect(componentSource).not.toContain('ขนาดไม่เกิน 2 MB');
  });

  it('keeps permanent deletion inside the admin history flow', () => {
    expect(componentSource).toContain('canPermanentlyDeleteDocument(document, documents)');
    expect(componentSource).toContain('พิมพ์ DELETE เพื่อยืนยัน');
    expect(componentSource).toContain('services.permanentlyDelete(document.id)');
    expect(componentSource).toContain('ลบรายการและไฟล์ถาวรแล้ว');
    expect(componentSource).toContain('isAdmin && canPermanentlyDeleteDocument');
  });
});

describe('license document viewer and review', () => {
  it('requests a fresh signed view using only the selected document ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ data: { url: 'signed-result', mimeType: 'application/pdf', fileName: 'license.pdf' } }) });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', fetchMock);
    await api.viewLicenseDocument('access-token', 'document-id-123');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/license-documents/document-id-123/view');
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain('storageObjectKey');
  });

  it('renders PDF and image inline and clears viewer state on cleanup', () => {
    expect(componentSource).toContain('<iframe className="license-pdf-viewer"');
    expect(componentSource).toContain('<img src={viewer.url}');
    expect(componentSource).toContain('return () => { active = false; setViewer(undefined); }');
    expect(componentSource).not.toContain('localStorage');
    expect(componentSource).not.toContain('sessionStorage');
    expect(componentSource).not.toContain('console.log');
  });

  it('uses a body-level portal with fixed viewport, Escape, backdrop, and scroll lock', () => {
    expect(componentSource).toContain("document.getElementById('modal-root') || document.body");
    expect(componentSource).toContain("if (event.key === 'Escape') onCloseRef.current()");
    expect(componentSource).toContain('if (event.target === event.currentTarget) onClose()');
    expect(componentSource).toContain('const releaseScrollLock = acquireDocumentScrollLock()');
    expect(componentSource).toContain('releaseScrollLock()');
    expect(styleSource).toContain('position:fixed!important');
    expect(styleSource).toContain('inset:0!important');
    expect(styleSource).toContain('z-index:2147483100');
  });

  it('keeps Admin-only review actions, Admin self-approval, and distinct Thai review semantics', () => {
    expect(componentSource).toContain("isAdmin && document.status === 'PENDING'");
    expect(componentSource).not.toMatch(/uploadedBy[^\n]+disabled/);
    expect(componentSource).toContain('className="btn-approve"');
    expect(componentSource).toContain('className="btn-return"');
    expect(componentSource).toContain('className="btn-reject"');
    expect(componentSource).toContain('>อนุมัติ</button>');
    expect(componentSource).toContain('>ส่งกลับไปแก้ไข</button>');
    expect(componentSource).toContain('>ไม่อนุมัติ</button>');
    expect(componentSource).toContain('การไม่อนุมัติคำขอเป็นการสิ้นสุดคำขอ แต่จะไม่ลบไฟล์หรือประวัติของคำขอ');
  });

  it('renders review from the license table only for admins with a pending document', () => {
    expect(componentSource).toContain('summary?.pendingDocumentId');
    expect(componentSource).toContain('isAdmin && summary?.reviewAvailable && summary.pendingDocumentId');
    expect(componentSource).toContain('isAdmin: boolean; onChanged: (message: string) => void');
    expect(mainSource).toContain("isAdmin={role === 'ADMIN'}");
    expect(mainSource).toContain('onChanged={onLicenseDocumentChanged}');
  });

  it('requires a non-whitespace rejection reason and prevents double submission', () => {
    expect(componentSource).toContain("const cleaned = reason.trim()");
    expect(componentSource).toContain("if (!cleaned) { setError('กรุณาระบุเหตุผลที่ไม่อนุมัติ')");
    expect(componentSource).toContain('disabled={busy || !reason.trim()}');
    expect(componentSource).toContain('if (busy) return;');
  });

  it('uses shared approval action aliases with accessible focus and disabled semantics', () => {
    expect(mainSource).toContain("import './styles/action-system.css';");
    expect(actionStyleSource).toContain('button.btn-approve');
    expect(actionStyleSource).toContain('button.btn-return');
    expect(actionStyleSource).toContain('button.btn-reject');
    expect(actionStyleSource).toContain('button.btn-resubmit');
    expect(actionStyleSource).toContain('button.btn-cancel');
    expect(actionStyleSource).toContain('button.btn-approve:focus-visible');
    expect(actionStyleSource).toContain('button.btn-cancel:disabled');
    expect(componentSource).toContain('className="btn-resubmit"');
    expect(componentSource).toContain('className="btn-cancel"');
    expect(componentSource).toContain('ยืนยันยกเลิกคำขอของฉัน?');
    expect(componentSource).toContain('การยกเลิกไม่ใช่การไม่อนุมัติของผู้ตรวจสอบ');
  });
});

describe('license document history and safety', () => {
  it('sorts history newest-first and retains superseded documents', () => {
    const rows = sortLicenseDocuments([
      documentRow({ id: 'old', status: 'SUPERSEDED', version: 1 }),
      documentRow({ id: 'new', status: 'APPROVED', isCurrent: true, version: 2 })
    ]);
    expect(rows.map((item) => item.id)).toEqual(['new', 'old']);
    expect(rows[1].status).toBe('SUPERSEDED');
    expect(componentSource).toContain('licenseDocumentStatusLabel[document.status]');
  });

  it('renders immutable revision history with deterministic revision identity and correction context', () => {
    expect(componentSource).toContain('license-revision-list');
    expect(componentSource).toContain('Revision {revision.revision}');
    expect(componentSource).toContain('revision.safeDisplayFileName');
    expect(componentSource).toContain('revision.submittedBy?.displayName');
    expect(componentSource).toContain('revision.correctionReason');
  });
  it('sanitizes internal details, storage data, URLs, and stack traces', () => {
    expect(sanitizeLicenseDocumentError(new Error('storageObjectKey=https://private.example/file'))).toBe('ระบบไม่สามารถดำเนินการเอกสารได้ชั่วคราว กรุณาลองใหม่อีกครั้ง');
    expect(sanitizeLicenseDocumentError(new Error('กรุณาลองใหม่'))).toBe('กรุณาลองใหม่');
  });

  it('refetches document history and exposes return/resubmit/cancel API adapters without widening review authority', () => {
    expect(componentSource).toContain('await load(); setNotice(message); window.setTimeout(() => onChanged(message), 1200)');
    expect(mainSource).toContain('returnLicenseDocumentForCorrection');
    expect(mainSource).toContain('resubmitLicenseDocument');
    expect(mainSource).toContain('cancelLicenseDocument');
    expect(componentSource).toContain('services.cancel(document.id)');
  });
});


describe('performance hardening license table contract', () => {
  it('does not fetch document history on LicenseTableDocumentColumns mount', () => {
    const start = componentSource.indexOf('export function LicenseTableDocumentColumns'); const end = componentSource.indexOf('function DocumentFacts', start); const tableBlock = componentSource.slice(start, end);
    expect(tableBlock).not.toContain('useEffect('); expect(tableBlock).toContain('summary?: LicenseTableDocumentSummary'); expect(tableBlock).toContain('const openReview = async () =>'); expect(tableBlock).toContain('services.list(license.id)'); expect(mainSource).toContain('summary={row.documentSummary as never}');
  });
});

describe('WAVE 4B responsive licenses contract', () => {
  it('uses the shared responsive table shell, state primitives, and pagination', () => {
    expect(mainSource).toContain('const licenseSurface = <ResponsiveDataTable');
    expect(mainSource).toContain('DataTableSkeletonRows');
    expect(mainSource).toContain('DataTableSkeletonCards');
    expect(mainSource).toContain('variant="empty"');
    expect(mainSource).toContain('variant="error"');
    expect(mainSource).toContain("ariaLabel={page === 'quota' ? 'แบ่งหน้าโควตาวันลา' : page === 'approvals' ? 'แบ่งหน้าประวัติการอนุมัติตารางกะ' : 'แบ่งหน้าใบอนุญาต'}");
    expect(mainSource).toContain('const licenseTableHeader = <tr>{config.columns.map((column) => <th key={column.label} scope="col">');
    expect(mainSource).toContain('aria-label="รายการใบอนุญาตพนักงาน"');
  });

  it('keeps mobile priority information and long-content wrapping without changing document authority', () => {
    expect(mainSource).toContain("config.columns.filter((column) => column.label !== 'ดูไฟล์').slice(0, 5)");
    expect(mainSource).toContain('aria-label={`เปิดรายละเอียดใบอนุญาต');
    expect(mainSource).toContain('LicenseTableDocumentColumns');
    expect(mainSource).toContain("onAction(row, 'delete')");
    expect(mainSource).toContain('onEditLicense ? onEditLicense(row) : onAction(row, \'edit\')');
    expect(mainSource).toContain('licenseDocumentServices');
    expect(mainSource).not.toContain('api.licenseDocuments(token!, licenseId).then');
    expect(mainSource).toContain('DataTablePagination page={currentPage}');
    expect(dataSurfaceStyleSource).toContain('.data-surface-page--licenses .signature-mobile-record > strong');
    expect(dataSurfaceStyleSource).toContain('overflow-wrap: anywhere');
  });
});
