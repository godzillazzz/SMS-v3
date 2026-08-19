import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.tsx');
const css = read('styles/signature-experience-v1-2.css');
const v11 = read('styles/signature-experience-v1-1.css');
const personnel = read('components/personnel/PersonnelTable.tsx');
const actionColumn = read('components/TableActionColumn.tsx');
const passkeyPanel = read('components/PasskeySecurityPanel.tsx');
const api = read('api.ts');
const dashboard = read('styles/dashboard.css');
const licenseDocuments = read('styles/license-documents.css');
const reportCenter = read('styles/report-center.css');
const executiveReport = read('styles/executive-report.css');

describe('SMS Signature Experience V1.2 visual reconciliation', () => {
  it('loads the V1.2 authority after V1.1 without regressing typography', () => {
    expect(main).toContain("import './styles/signature-experience-v1-2.css';");
    expect(main.indexOf("import './styles/signature-experience-v1-2.css';")).toBeGreaterThan(main.indexOf("import './styles/signature-experience-v1-1.css';"));
    expect(v11).toContain('--font-ui: "Noto Sans Thai", "Inter"');
    expect(v11).toContain('--font-mono: "IBM Plex Mono"');
    expect(css).not.toContain('Leelawadee UI');
  });

  it('restores VF071-derived Light Login atmosphere while keeping readable hero semantics', () => {
    expect(css).toContain('[data-theme="light"] .login-intro.auth-brand-panel');
    expect(css).toContain('linear-gradient(150deg, #f5f1ff 0%, #fbf7ff 54%, #fff5ef 112%)');
    expect(css).toContain('[data-theme="light"] .auth-brand-copy h1');
    expect(css).toContain('color: #27213a !important;');
    expect(css).toContain('[data-theme="dark"] .auth-brand-copy h1');
    expect(css).toContain('color: #f7f8ff !important;');
  });

  it('locks the global dark heading/text contract including Reports and Data Quality', () => {
    for (const selector of ['.report-center-heading h1', '.executive-report-heading h1', '.data-quality-header h1', '.audit-page-header h1', '.page-heading h1']) expect(css).toContain(selector);
    expect(css).toMatch(/\[data-theme="dark"\][\s\S]*?\.report-center-heading h1[\s\S]*?color:var\(--text-primary\) !important;/);
    expect(css).toContain('.report-center-heading p');
    expect(css).toContain('color:var(--text-secondary) !important;');
  });

  it('uses one reusable action-column geometry for Personnel and operational/License tables', () => {
    expect(actionColumn).toContain('data-action-column--header');
    expect(actionColumn).toContain('data-action-column--cell');
    expect(actionColumn).toContain('data-action-group');
    expect(personnel).toContain('<TableActionHeader label="จัดการ" />');
    expect(personnel).toContain('<TableActionCell className="personnel-row-actions data-row-actions"');
    expect(main).toContain('<TableActionHeader label="ดำเนินการ" />');
    expect(main).toContain('<TableActionCell className="row-actions data-row-actions"');
    expect(css).toContain('--data-action-column-width: 184px;');
    expect(css).toContain('text-align:center !important;');
    expect(css).toContain('justify-content:center;');
  });

  it('preserves V1.1 high-contrast Schedule and mobile contracts', () => {
    expect(v11).toContain('[data-theme="dark"] .schedule-grid .employee-sticky strong');
    expect(v11).toContain('color: var(--table-text-primary) !important;');
    expect(v11).toContain('.dashboard-secondary-metrics { display: none !important; }');
    expect(v11).toContain('.personnel-search-input.data-search-control');
    expect(v11).toContain('height: 46px !important;');
  });

  it('provides an explicit active, inactive, and all License employee filter', () => {
    expect(main).toContain("type LicenseEmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'ALL';");
    expect(main).toContain("useState<LicenseEmployeeStatus>('ACTIVE')");
    expect(main).toContain('className="license-employee-status-filter"');
    expect(main).toContain('<option value="ACTIVE">ปฏิบัติงาน</option>');
    expect(main).toContain('<option value="INACTIVE">พ้นสภาพ</option>');
    expect(main).toContain('<option value="ALL">ทั้งหมด</option>');
    expect(api).toContain('employeeStatus: \'ACTIVE\' | \'INACTIVE\' | \'ALL\' = \'ACTIVE\'');
    expect(main).toContain('api.licenses(auth.token, operationPage, licenseEmployeeStatus)');
  });

  it('uses local dark surfaces for License, Reports, Executive Report, and Leave', () => {
    expect(css).toContain('.license-modal-dialog');
    expect(css).toContain('--license-local-surface:var(--color-surface-elevated);');
    expect(css).toContain('[data-theme="dark"] .report-center-filter-card');
    expect(css).toContain('[data-theme="dark"] .executive-report-panel');
    expect(css).toContain('[data-theme="dark"] .leave-page');
    expect(css).toContain('.leave-page h1');
    expect(licenseDocuments).toContain('.license-modal-dialog');
    expect(reportCenter).toContain('.report-center-filter-card');
    expect(executiveReport).toContain('.executive-report-panel');
  });

  it('keeps action cells in the table layout and normalizes Dashboard KPI geometry', () => {
    expect(css).toContain('.data-action-column--cell.data-row-actions { display:table-cell;');
    expect(css).toContain('.data-action-column--cell .data-action-group { display:flex;');
    expect(dashboard).not.toContain('.dashboard-page-v2 button');
    expect(css).toContain('.dashboard-page-v2 .dashboard-metric { display:flex;');
    expect(css).toContain('.dashboard-page-v2 .dashboard-metric--interactive');
  });
});

describe('SMS V1.2 Passkey product/security UI contract', () => {
  it('keeps password login and adds a secondary Passkey action with truthful device-verification language', () => {
    expect(main).toContain('เข้าสู่ระบบด้วย Passkey');
    expect(main).toContain('Face ID • ลายนิ้วมือ • Windows Hello');
    expect(main).toContain('type="password"');
    expect(main).toContain('auth-primary-action');
    expect(main).not.toMatch(/face recognition only/i);
  });

  it('uses SimpleWebAuthn browser APIs and the same AuthContext/session state', () => {
    expect(main).toContain("startAuthentication({ optionsJSON: challenge.options })");
    expect(main).toContain('api.passkeyLoginVerify(challenge.challengeId, response)');
    expect(main).toContain('setToken(result.accessToken)');
    expect(main).toContain('setUser(result.user)');
    expect(passkeyPanel).toContain('startRegistration({ optionsJSON: challenge.options })');
  });

  it('provides authenticated enrollment, inventory, rename, revoke and password step-up without biometric storage claims', () => {
    expect(passkeyPanel).toContain('เพิ่ม Passkey');
    expect(passkeyPanel).toContain('current-password');
    expect(passkeyPanel).toContain('เปลี่ยนชื่อ');
    expect(passkeyPanel).toContain('ยืนยันยกเลิก Passkey');
    expect(passkeyPanel).toContain('SMS ไม่ได้รับข้อมูลชีวมิติ');
    expect(passkeyPanel).not.toMatch(/camera|ถ่ายใบหน้า|facial embedding/i);
    expect(api).toContain("passkeyRegistrationOptions:");
    expect(api).toContain("revokePasskey:");
  });

  it('keeps Passkey management accessible to all authenticated roles through profile utilities instead of admin-only navigation', () => {
    expect(main).toContain('topbar-profile-button');
    expect(main).toContain('setPasskeyPanelOpen(true)');
    expect(main).toContain('mobile-utility-security');
    expect(main).toContain('<PasskeySecurityPanel token={auth.token}');
  });
});
