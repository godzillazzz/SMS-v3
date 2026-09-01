import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const main = read('main.tsx');
const dataCss = read('styles/data-surfaces.css');
const foundation = read('styles/theme-foundation.css');
const legacyDesign = read('design-system.css');
const personnelPage = read('pages/personnel/PersonnelDirectoryPage.tsx');
const personnelToolbar = read('components/personnel/PersonnelSearchToolbar.tsx');
const personnelTable = read('components/personnel/PersonnelTable.tsx');
const personnelPagination = read('components/personnel/PersonnelPagination.tsx');
const accessPage = read('pages/access-management/AccessManagementPage.tsx');
const accessUtils = read('components/access-management/access-management-utils.ts');
const auditPage = read('pages/audit/AuditCompliancePage.tsx');
const auditTable = read('components/audit/AuditTable.tsx');
const auditUtils = read('components/audit/audit-utils.ts');
const dataQuality = read('pages/data-quality/DataQualityCenterPage.tsx');
const rowMenu = read('components/DataRowActionMenu.tsx');
const apiBytes = fs.readFileSync(path.join(root, 'api.ts'), 'utf8').replace(/\r\n/g, '\n');

const apiSha256 = createHash('sha256').update(apiBytes).digest('hex');

describe('G04.2 UX-03 data surfaces contract', () => {
  it('loads one authoritative data-surface layer after semantic foundation and application shell', () => {
    const tokens = main.indexOf("import './styles/tokens.css';");
    const theme = main.indexOf("import './styles/theme-foundation.css';");
    const shell = main.indexOf("import './styles/app-shell.css';");
    const data = main.indexOf("import './styles/data-surfaces.css';");
    expect(tokens).toBeGreaterThan(-1);
    expect(theme).toBeGreaterThan(tokens);
    expect(shell).toBeGreaterThan(theme);
    expect(data).toBeGreaterThan(shell);
    expect(dataCss).toContain('authoritative enterprise data-surface system');
    expect(foundation).toContain('Data table/card ownership moved to styles/data-surfaces.css in UX-03');
    expect(legacyDesign).toContain('UX-03 data table/toolbar/status ownership: styles/data-surfaces.css');
    expect(foundation).not.toMatch(/\.data-table\s*\{/);
    expect(foundation).not.toMatch(/\.pagination-bar\s*\{/);
  });

  it('uses the approved semantic typography and operational row geometry', () => {
    expect(dataCss).toContain('--data-header-height: 46px');
    expect(dataCss).toContain('--data-row-height: 52px');
    expect(dataCss).toContain('--data-control-height: 40px');
    expect(dataCss).toMatch(/\.data-surface-table\s*\{[\s\S]*font-size:\s*13px/);
    expect(dataCss).toMatch(/\.data-surface-table thead th\s*\{[\s\S]*font-size:\s*12px/);
    expect(dataCss).toMatch(/\.data-surface-table td strong,[\s\S]*font-size:\s*14px/);
    expect(dataCss).toMatch(/\.data-surface-table td small,[\s\S]*font-size:\s*12px/);
    expect(dataCss).toContain('font-family: var(--font-sans)');
  });

  it('maps status presentation to semantic tokens without hard-coded status colors', () => {
    ['--color-success', '--color-success-soft', '--color-warning', '--color-warning-soft', '--color-attention', '--color-attention-soft', '--color-danger', '--color-danger-soft', '--color-info', '--color-info-soft'].forEach((token) => expect(dataCss).toContain(token));
    expect(dataCss).toContain('.status-badge--success');
    expect(dataCss).toContain('.status-badge--warning');
    expect(dataCss).toContain('.status-badge--attention');
    expect(dataCss).toContain('.status-badge--danger');
    expect(dataCss).toContain('.status-badge--info');
    expect(dataCss).toContain('.status-badge--neutral');
    expect(dataCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(main).toContain('semanticStatusTone(row.status)');
  });

  it('keeps Personnel search, department, status filtering and page size behavior unchanged', () => {
    expect(personnelPage).toContain("const matchesTerm = !term || [employee.employeeCode, employee.firstName, employee.lastName, employee.department, employee.jobTitle]");
    expect(personnelPage).toContain('const matchesDepartment = !department || employee.department === department');
    expect(personnelPage).toContain("const matchesStatus = !status || (status === 'active' ? employee.isActive : !employee.isActive)");
    expect(personnelPage).toContain('const pageSize = 10');
    expect(personnelPage).toContain('filtered.slice((page - 1) * pageSize, page * pageSize)');
    expect(personnelToolbar).toContain('onSearch(event.target.value)');
    expect(personnelToolbar).toContain('onDepartment(event.target.value)');
    expect(personnelToolbar).toContain('onStatus(event.target.value)');
  });

  it('keeps Personnel pagination mathematics unchanged while normalizing controls', () => {
    expect(personnelPagination).toContain('onChange(page - 1)');
    expect(personnelPagination).toContain('onChange(page + 1)');
    expect(personnelPagination).toContain('disabled={page === 1}');
    expect(personnelPagination).toContain('disabled={page === totalPages}');
    expect(personnelPagination).toContain('data-pagination');
  });

  it('keeps Access Management permission/action authority in visibleAccountActions', () => {
    expect(accessPage).toContain('visibleAccountActions(role, account, originalUserId)');
    expect(accessPage).toContain("actions.includes('approve')");
    expect(accessPage).toContain("actions.includes('edit')");
    expect(accessPage).toContain('onUpdate(target.id');
    expect(accessPage).toContain('onResetPassword(target.id, password)');
    expect(accessPage).toContain('executeConfirmedViewAs(target.id, onViewAs)');
    expect(accessUtils).toContain('export function visibleAccountActions');
    expect(accessPage).toContain('<DataRowActionMenu');
    expect(accessPage).toContain('className="account-mobile-card data-mobile-card"');
  });

  it('keeps License document permissions and edit/delete action callbacks unchanged', () => {
    expect(main).toContain('LicenseTableDocumentColumns');
    expect(main).toContain("list: async (licenseId: string) => (await api.licenseDocuments(token!, licenseId))");
    expect(main).toContain('approve: async (documentId: string) => { await api.approveLicenseDocument(token!, documentId); }');
    expect(main).toContain('reject: async (documentId: string, reason: string) => { await api.rejectLicenseDocument(token!, documentId, reason); }');
    expect(main).toContain("onEditLicense ? onEditLicense(row) : onAction(row, 'edit')");
    expect(main).toContain("onSelect: () => onAction(row, 'delete')");
    expect(main).toContain("role === 'ADMIN' && <DataRowActionMenu");
  });

  it('keeps Leave month/year, approval, reject, quota and cancellation behavior unchanged', () => {
    expect(main).toContain('MonthGridPicker value={historyMonth} onChange={onHistoryMonthChange}');
    expect(main).toContain('onHistoryMonthChange={changeLeaveMonth}');
    expect(main).toContain('onHistoryMonthStep(-1)');
    expect(main).toContain('onHistoryMonthStep(1)');
    expect(main).toContain('onHistoryPageChange((historyPage || 1) - 1)');
    expect(main).toContain('onHistoryPageChange((historyPage || 1) + 1)');
    expect(main).toContain('onApprove(row)');
    expect(main).toContain('onReject(row)');
    expect(main).toContain('canCancelApprovedLeave');
    expect(main).toContain('onCancel(row)');
    expect(main).toContain('quotaCards');
  });

  it('preserves Audit safe metadata and preview security behavior', () => {
    expect(auditTable).toContain('safeMetadataEntries(metadata)');
    expect(auditTable).toContain('metadataSummary(row.metadata)');
    expect(auditTable).toContain('event.stopPropagation(); onSelect(row)');
    expect(auditPage).toContain('permissionDenied');
    expect(auditUtils).toContain('safeMetadataEntries');
    expect(auditUtils).toContain('sensitive');
  });

  it('keeps the authorized API source blob locked after Attachment Optimizer V1', () => {
    expect(apiSha256).toBe('cf2716135db93c1911b4a296ecdadb5f0ea22fbd6745b4d13f079805ef879b48');
  });

  it('provides an accessible shared row-action menu with focus restoration and viewport containment', () => {
    expect(rowMenu).toContain('aria-haspopup="menu"');
    expect(rowMenu).toContain('aria-expanded={open}');
    expect(rowMenu).toContain('role="menu"');
    expect(rowMenu).toContain('role="menuitem"');
    expect(rowMenu).toContain("event.key === 'Escape'");
    expect(rowMenu).toContain("event.key === 'ArrowDown'");
    expect(rowMenu).toContain("event.key === 'ArrowUp'");
    expect(rowMenu).toContain("event.key === 'Home'");
    expect(rowMenu).toContain("event.key === 'End'");
    expect(rowMenu).toContain('triggerRef.current?.focus()');
    expect(rowMenu).toContain('window.innerWidth - MENU_WIDTH - VIEWPORT_GAP');
    expect(rowMenu).toContain('window.innerHeight - VIEWPORT_GAP');
    expect(rowMenu).toContain('createPortal');
    expect(dataCss).toMatch(/\.data-row-more-trigger\s*\{[\s\S]*min-width:\s*40px/);
  });

  it('retains mobile actions instead of hiding operational capability', () => {
    expect(personnelTable).toContain('data-row-primary-action');
    expect(personnelTable).not.toContain('จัดการสถานะพนักงาน');
    expect(accessPage).toContain('เปิดรายละเอียด');
    expect(dataQuality).toContain('data-mobile-card');
    expect(auditTable).toContain('ดูรายละเอียด');
    expect(dataCss).toContain('.data-mobile-card');
  });

  it('does not fabricate the unavailable Personnel review count', () => {
    expect(personnelPage).not.toContain('label="รอตรวจสอบ"');
    expect(personnelPage).not.toContain('context="ยังไม่มีข้อมูล" tone="blue"');
    expect(personnelPage).toContain('label="บุคลากรทั้งหมด" value={totalCount}');
    expect(personnelPage).toContain('label="โปรไฟล์ไม่สมบูรณ์" value={incomplete}');
  });

  it('contains horizontal table scrolling within data surfaces and preserves mobile domain cards', () => {
    expect(dataCss).toMatch(/\.data-table-scroll\s*\{[\s\S]*max-width:\s*100%[\s\S]*overflow-x:\s*auto/);
    expect(dataCss).toContain('overscroll-behavior-inline: contain');
    expect(dataCss).toContain('.personnel-table-scroll.data-table-scroll');
    expect(dataCss).toContain('.access-mobile-cards');
    expect(dataCss).toContain('.audit-mobile-cards');
    expect(dataCss).toContain('.data-quality-mobile-cards');
  });
});
