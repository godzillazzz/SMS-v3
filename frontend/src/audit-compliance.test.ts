import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const app = read('main.tsx');
const page = read('pages/audit/AuditCompliancePage.tsx');
const toolbar = read('components/audit/AuditToolbar.tsx');
const table = read('components/audit/AuditTable.tsx');
const preview = read('components/audit/AuditEventPreview.tsx');
const styles = read('styles/audit-compliance.css');
const dataTable = read('components/ResponsiveDataTable.tsx');

describe('admin audit log viewer contract', () => {
  it('keeps the dedicated page ADMIN-only and uses server-side filter state', () => {
    expect(app).toContain("id: 'audit'");
    expect(app).toContain("return auth.user?.role === 'ADMIN';");
    expect(app).toContain('api.auditEvents(auth.token, operationPage, auditPageSize, auditFilters)');
    expect(app).toContain('filters={auditFilters}');
    expect(page).toContain('onFiltersChange');
  });

  it('renders required filters and bounded pagination controls', () => {
    for (const label of ['ตั้งแต่วันที่', 'ถึงวันที่', 'ผู้ใช้งาน', 'Module', 'Action', 'ค้นหา', 'ล้างตัวกรอง']) expect(toolbar).toContain(label);
    expect(toolbar).toContain('value={25}');
    expect(toolbar).toContain('value={100}');
    expect(dataTable).toContain('หน้า {page} จาก {totalPages}');
  });

  it('keeps details read-only, redacted, and usable on mobile', () => {
    expect(table).toContain('Unknown / Deleted User');
    expect(table).toContain('ดูรายละเอียด');
    expect(table).toContain('audit-mobile-cards');
    expect(table).toContain('audit-desktop-table');
    expect(table).toContain('mobileMetadataSummary');
    expect(table).toContain('safeMetadataEntries');
    expect(preview).toContain('ซ่อนข้อมูลที่อ่อนไหว');
    expect(preview).toContain('safeMetadataEntries');
    expect(table).toContain('ไม่สามารถโหลดบันทึกการใช้งานระบบ');
    expect(table).toContain('ไม่พบรายการ Audit Log ตามเงื่อนไขที่เลือก');
    expect(table).toContain('audit-skeleton-row');
    expect(table).not.toContain('data-label=');
  });

  it('uses a separate vertical card structure for small screens without changing desktop tables', () => {
    const mobileStyles = read('styles/audit-mobile.css');
    expect(table).toContain('<table className="audit-table data-surface-table" aria-label="รายการ Audit Log"><thead><tr><th');
    expect(table).toContain('</thead><tbody>');
    expect(table).toContain('<td>{formatAuditTime(row.createdAt)}</td>');
    expect(table).toContain('<article key={safe(row.id, `mobile-event-${index}`)}');
    expect(table).not.toContain('data-label=');
    expect(mobileStyles).toContain('@media (max-width: 640px)');
    expect(mobileStyles).toContain('.audit-desktop-table .audit-table tbody td');
    expect(mobileStyles).toContain('display: table-cell !important;');
    expect(mobileStyles).toContain('content: none !important;');
    expect(mobileStyles).toContain('.audit-desktop-table');
    expect(mobileStyles).toContain('display: block;');
    expect(mobileStyles).toContain('display: none;');
    expect(mobileStyles).toContain('  .audit-desktop-table {\n    display: none;\n  }');
    expect(mobileStyles).toContain('.audit-mobile-cards {');
    expect(mobileStyles).toContain('display: grid;');
    expect(mobileStyles).toContain('overflow-wrap: anywhere;');
    expect(mobileStyles).toContain('text-overflow: ellipsis;');
    expect(mobileStyles).toContain('min-height: 40px;');
    expect(mobileStyles).not.toContain('@media (min-width: 641px)');
  });

  it('guards the legacy <=760px table transform with an explicit desktop reset', () => {
    const mobileStyles = read('styles/audit-mobile.css');
    expect(styles).toContain('@media(max-width:760px)');
    expect(mobileStyles).toContain('.audit-desktop-table .audit-table tbody tr {\n  display: table-row;');
    expect(mobileStyles).toContain('.audit-desktop-table .audit-table tbody td {\n  display: table-cell !important;');
    expect(mobileStyles).toContain('.audit-desktop-table .audit-table tbody td::before {\n  display: none;');
    expect(mobileStyles).toContain('content: none !important;');
    expect(table).not.toContain('data-label=');
  });
});
