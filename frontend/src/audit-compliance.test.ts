import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const app = read('main.tsx');
const page = read('pages/audit/AuditCompliancePage.tsx');
const toolbar = read('components/audit/AuditToolbar.tsx');
const table = read('components/audit/AuditTable.tsx');
const preview = read('components/audit/AuditEventPreview.tsx');
const styles = read('styles/audit-compliance.css');

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
    expect(page).toContain('หน้า {page} จาก {totalPages}');
  });

  it('keeps details read-only, redacted, and usable on mobile', () => {
    expect(table).toContain('Unknown / Deleted User');
    expect(table).toContain('ดูรายละเอียด');
    expect(table).toContain('audit-mobile-cards');
    expect(table).toContain('mobileMetadataSummary');
    expect(table).toContain('safeMetadataEntries');
    expect(preview).toContain('ซ่อนข้อมูลที่อ่อนไหว');
    expect(preview).toContain('safeMetadataEntries');
    expect(page).toContain('ไม่สามารถโหลดบันทึกการใช้งานระบบ');
    expect(table).toContain('ไม่พบรายการ Audit Log ตามเงื่อนไขที่เลือก');
    expect(table).toContain('audit-skeleton-row');
    expect(styles).toContain('audit-table tbody td::before');
    expect(styles).toContain('@media(max-width:760px)');
  });

  it('uses a separate vertical card structure for small screens without changing desktop tables', () => {
    const mobileStyles = read('styles/audit-mobile.css');
    expect(mobileStyles).toContain('@media (max-width: 640px)');
    expect(mobileStyles).toContain('.audit-table-scroll');
    expect(mobileStyles).toContain('display: none;');
    expect(mobileStyles).toContain('overflow-wrap: anywhere;');
    expect(mobileStyles).toContain('text-overflow: ellipsis;');
    expect(mobileStyles).toContain('min-height: 40px;');
    expect(mobileStyles).not.toContain('@media (min-width: 641px)');
  });
});
