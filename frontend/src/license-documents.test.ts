import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { api } from './api';
import {
  LicenseDocument,
  licenseValidityLabel,
  sanitizeLicenseDocumentError,
  licenseTableStatus,
  selectLicenseDocumentForTable,
  selectLicenseDocumentSummary,
  sortLicenseDocuments
} from './components/license-document-utils';

const componentSource = fs.readFileSync(path.join(__dirname, 'components', 'LicenseDocuments.tsx'), 'utf-8');
const mainSource = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf-8');
const styleSource = fs.readFileSync(path.join(__dirname, 'styles', 'license-documents.css'), 'utf-8');
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
    expect(mainSource).toContain('className="btn-danger-outline compact" aria-label="ลบใบอนุญาต"');
    expect(mainSource).toContain("page === 'licenses' ? renderLicenseCell");
  });

  it('selects the approved current file before pending renewals', () => {
    const current = documentRow({ id: 'approved', status: 'APPROVED', isCurrent: true, version: 2 });
    const renewal = documentRow({ id: 'pending', status: 'PENDING', version: 3 });
    expect(selectLicenseDocumentForTable([renewal, current])?.id).toBe('approved');
    expect(licenseTableStatus([renewal, current]).label).toBe('มีรายการรอตรวจสอบ');
  });

  it('selects pending or rejected files only when no current file exists', () => {
    const pending = documentRow({ id: 'pending', status: 'PENDING', version: 2 });
    const rejected = documentRow({ id: 'rejected', status: 'REJECTED', version: 1 });
    expect(selectLicenseDocumentForTable([pending])?.id).toBe('pending');
    expect(selectLicenseDocumentForTable([rejected])?.id).toBe('rejected');
    expect(selectLicenseDocumentForTable([])).toBeUndefined();
  });

  it('does not make a retention-deleted file clickable', () => {
    const deleted = documentRow({ status: 'APPROVED', isCurrent: true, storageDeletedAt: '2026-08-01T00:00:00Z' });
    expect(selectLicenseDocumentForTable([deleted])?.storageDeletedAt).toBeTruthy();
    expect(componentSource).toContain('ไฟล์ต้นฉบับถูกลบตามนโยบายจัดเก็บข้อมูล');
  });

  it('supports empty, pending, approved, and rejected Thai badges', () => {
    expect(componentSource).toContain('ยังไม่มีไฟล์');
    expect(componentSource).toContain('licenseDocumentStatusLabel[document.status]');
    expect(componentSource).toContain('เหตุผล: {document.rejectionReason}');
  });

  it('keeps an approved current document and pending renewal visible together', () => {
    const current = documentRow({ id: 'approved', status: 'APPROVED', isCurrent: true, version: 2 });
    const renewal = documentRow({ id: 'pending', status: 'PENDING', version: 3 });
    const summary = selectLicenseDocumentSummary([current, renewal]);
    expect(summary.current?.id).toBe('approved');
    expect(summary.pending.map((item) => item.id)).toEqual(['pending']);
    expect(componentSource).toContain('ฉบับต่ออายุรอตรวจสอบ');
  });

  it('uses the existing 60-day warning rule without timezone shifting date-only values', () => {
    const now = new Date('2026-07-31T18:00:00Z');
    expect(licenseValidityLabel('2026-01-01', '2026-07-30', 'Active', now)).toBe('หมดอายุ');
    expect(licenseValidityLabel('2026-01-01', '2026-08-15', 'Active', now)).toBe('ใกล้หมดอายุ');
    expect(licenseValidityLabel('2026-01-01', '2027-01-01', 'Active', now)).toBe('ปกติ');
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
    expect(componentSource).toContain("document.body.style.overflow = 'hidden'");
    expect(styleSource).toContain('position:fixed!important');
    expect(styleSource).toContain('inset:0!important');
    expect(styleSource).toContain('z-index:2147483100');
  });

  it('allows an admin uploader to approve and confirms old/new dates', () => {
    expect(componentSource).toContain("isAdmin && document.status === 'PENDING'");
    expect(componentSource).not.toMatch(/uploadedBy[^\n]+disabled/);
    expect(componentSource).toContain('วันหลักจะเปลี่ยนจาก');
    expect(componentSource).toContain("setMode('approve')");
  });

  it('requires a non-whitespace rejection reason and prevents double submission', () => {
    expect(componentSource).toContain("const cleaned = reason.trim()");
    expect(componentSource).toContain("if (!cleaned) { setError('กรุณาระบุเหตุผลที่ไม่อนุมัติ')");
    expect(componentSource).toContain('disabled={busy || !reason.trim()}');
    expect(componentSource).toContain('if (busy) return;');
  });

  it('uses centralized accessible action colors without changing license handlers', () => {
    expect(mainSource).toContain('import \'./styles/action-system.css\';');
    expect(actionStyleSource).toContain('--sms-action-primary: #2563eb');
    expect(actionStyleSource).toContain('.btn-info-outline');
    expect(actionStyleSource).toContain('.btn-danger-outline');
    expect(actionStyleSource).toContain('.license-table-view .btn-icon-only');
    expect(actionStyleSource).toContain('button.btn-success');
    expect(actionStyleSource).toContain('button.btn-danger:focus-visible');
    expect(componentSource).toContain('className="btn-danger-outline"');
    expect(componentSource).toContain('className="btn-success"');
    expect(componentSource).toContain('className="btn-ghost license-view-button"');
    expect(componentSource).toContain('onClick={() => setMode(\'reject\')}');
    expect(componentSource).toContain('onClick={() => setMode(\'approve\')}');
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

  it('sanitizes internal details, storage data, URLs, and stack traces', () => {
    expect(sanitizeLicenseDocumentError(new Error('storageObjectKey=https://private.example/file'))).toBe('ระบบไม่สามารถดำเนินการเอกสารได้ชั่วคราว กรุณาลองใหม่อีกครั้ง');
    expect(sanitizeLicenseDocumentError(new Error('กรุณาลองใหม่'))).toBe('กรุณาลองใหม่');
  });

  it('refetches document history and the license table after mutations and upload', () => {
    expect(componentSource).toContain('await load(); setNotice(message); window.setTimeout(() => onChanged(message), 1200)');
    expect(mainSource).toContain('onLicenseDocumentChanged={() => setOperationRefresh((value) => value + 1)}');
    expect(mainSource).toContain("if (action === 'document' && activePage === 'licenses')");
  });
});
