import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(__dirname);
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const tokens = read('styles/tokens.css');
const css = read('styles/visual-fidelity.css');
const main = read('main.tsx');
const metrics = read('components/dashboard/MetricsGrid.tsx');
const quick = read('components/dashboard/QuickActionsCard.tsx');
const personnel = read('pages/personnel/PersonnelDirectoryPage.tsx');
const access = read('pages/access-management/AccessManagementPage.tsx');
const review = read('pages/access-management/RegistrationReviewPanel.tsx');
const apiBytes = fs.readFileSync(path.join(root, 'api.ts'), 'utf8').replace(/\r\n/g, '\n');
const apiSha256 = crypto.createHash('sha256').update(apiBytes).digest('hex');

describe('G04.2 VF-04 mockup lock visual contract', () => {
  it('raises Light pastel ambience and Dark aurora/glow intensity in semantic tokens', () => {
    expect(tokens).toContain('--pastel-page-lavender: rgba(217, 204, 255, 0.64);');
    expect(tokens).toContain('--pastel-page-blush: rgba(250, 217, 229, 0.53);');
    expect(tokens).toContain('--pastel-page-sky: rgba(200, 237, 245, 0.44);');
    expect(tokens).toContain('--pastel-page-lavender: rgba(139, 124, 246, 0.25);');
    expect(tokens).toContain('--pastel-page-sky: rgba(34, 211, 238, 0.10);');
    expect(tokens).toContain('--pastel-halo-primary: rgba(139, 124, 246, 0.16);');
    expect(tokens).toContain('--pastel-halo-success: rgba(52, 211, 153, 0.11);');
    expect(tokens).toContain('--pastel-halo-warning: rgba(228, 173, 89, 0.11);');
    expect(tokens).toContain('--pastel-halo-danger: rgba(244, 114, 182, 0.11);');
    expect(tokens).toContain('--pastel-halo-info: rgba(34, 211, 238, 0.10);');
  });

  it('locks broad Light pastel and Dark Aurora environmental illumination', () => {
    expect(css).toContain('G04.2 VF-04 — Mockup Lock');
    expect(css).toMatch(/\[data-theme="light"\] body \{[\s\S]*?var\(--pastel-page-lavender\)[\s\S]*?var\(--pastel-page-peach\)[\s\S]*?var\(--pastel-page-blush\)[\s\S]*?var\(--pastel-page-sky\)[\s\S]*?var\(--pastel-page-mint\)/);
    expect(css).toMatch(/\[data-theme="dark"\] body \{[\s\S]*?var\(--pastel-page-lavender\)[\s\S]*?var\(--pastel-page-sky\)[\s\S]*?var\(--pastel-page-mint\)[\s\S]*?var\(--pastel-page-blush\)[\s\S]*?var\(--pastel-page-peach\)/);
    expect(css).toContain('background-attachment: fixed;');
  });

  it('increases Dark shell color without changing navigation architecture', () => {
    expect(css).toMatch(/\[data-theme="dark"\] \.sidebar \{[\s\S]*?var\(--color-primary\)[\s\S]*?var\(--decorative-blush\)[\s\S]*?var\(--decorative-sky\)/);
    expect(css).toMatch(/\[data-theme="dark"\] \.nav-item\.active \{[\s\S]*?linear-gradient/);
    expect(css).toMatch(/\[data-theme="dark"\] \.topbar \{[\s\S]*?var\(--color-primary\)[\s\S]*?var\(--decorative-sky\)/);
    expect(main).toContain("id: 'dashboard'");
    expect(main).toContain("id: 'employees'");
    expect(main).toContain("id: 'users'");
  });

  it('gives the four real Dashboard KPIs stronger partial Dark glows and preserves values', () => {
    expect(css).toMatch(/\[data-theme="dark"\] \.dashboard-metric \{[\s\S]*?var\(--vf03-accent\) 29%/);
    for (const label of ['กำลังปฏิบัติงาน', 'ลาวันนี้', 'รออนุมัติ', 'ต้องติดตาม']) expect(metrics).toContain(label);
    expect(metrics).toContain('tone="green"');
    expect(metrics).toContain('tone="teal"');
    expect(metrics).toContain('tone="warning"');
    expect(metrics).toContain('tone="urgent"');
  });

  it('makes real Quick Access modules colorful in both themes without fake HR modules', () => {
    expect(css).toMatch(/\[data-theme="dark"\] \.dashboard-quick-actions__grid button \{[\s\S]*?var\(--quick-accent\) 20%/);
    expect(css).toMatch(/\[data-theme="light"\] \.dashboard-quick-actions \{[\s\S]*?var\(--decorative-lavender\)[\s\S]*?var\(--decorative-sky\)/);
    for (const title of ['ข้อมูลพนักงาน', 'ตารางกะรายเดือน', 'รออนุมัติ', 'ใบอนุญาต รปภ.']) expect(quick).toContain(title);
    for (const fake of ['Payroll', 'Recruitment', 'Training', 'Benefits', 'เงินเดือน', 'สรรหา']) expect(quick).not.toContain(fake);
  });

  it('balances the Access desktop summary as five equal cards and preserves action authority', () => {
    expect(css).toMatch(/@media \(min-width: 1181px\)[\s\S]*?\.access-summary-grid:not\(\.access-summary-grid--manager\)[\s\S]*?repeat\(5, minmax\(0, 1fr\)\)/);
    for (const tone of ['indigo', 'green', 'amber', 'red', 'purple']) expect(access).toContain(`tone: '${tone}'`);
    expect(access).toContain('visibleAccountActions(role, account, originalUserId)');
    expect(access).toContain('executeConfirmedViewAs');
  });

  it('raises Personnel pastel/glow character while preserving filtering and pagination', () => {
    expect(css).toMatch(/\[data-theme="dark"\] \.personnel-metric \{[\s\S]*?var\(--vf03-accent\) 25%/);
    expect(css).toMatch(/\[data-theme="light"\] \.personnel-table\.data-surface-table thead th/);
    expect(personnel).toContain('const pageSize = 10;');
    expect(personnel).toContain('employee.department === department');
    expect(personnel).toContain("status === 'active' ? employee.isActive : !employee.isActive");
  });

  it('adds contextual Registration Review color while preserving select-compare-explicit-match workflow', () => {
    expect(css).toMatch(/\[data-theme="light"\] \.registration-review__requests \{[\s\S]*?var\(--decorative-lavender\)/);
    expect(css).toMatch(/\[data-theme="light"\] \.registration-review__detail \{[\s\S]*?var\(--decorative-sky\)/);
    expect(css).toMatch(/\[data-theme="dark"\] \.registration-review__employee-workspace \{[\s\S]*?var\(--color-success\)/);
    expect(css).toMatch(/\[data-theme="dark"\] \.registration-review__request\.is-selected \{[\s\S]*?var\(--color-primary\) 27%/);
    expect(review).toContain('api.matchRegistrationRequest(token, selected.id, employeeId)');
    expect(review).toContain('api.approveRegistrationRequest(token, selected.id)');
    expect(review).toContain('อนุมัติเป็น VIEWER');
    expect(review).not.toContain('window.prompt');
    expect(review).not.toContain('window.confirm');
  });

  it('deepens Dark Login Aurora while preserving accepted true single-column mobile auth', () => {
    expect(css).toMatch(/\[data-theme="dark"\] \.auth-experience-page \{[\s\S]*?var\(--color-primary\) 25%[\s\S]*?var\(--color-info\) 14%[\s\S]*?var\(--color-success\) 9%[\s\S]*?var\(--decorative-blush\)/);
    expect(css).toMatch(/\[data-theme="dark"\] \.auth-brand-panel \{[\s\S]*?var\(--color-primary\) 26%/);
    expect(main).toContain('className="auth-mobile-brand"');
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.auth-brand-panel\s*\{\s*display:\s*none !important;/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.auth-experience-shell\s*\{[\s\S]*?grid-template-columns:\s*1fr !important;/);
  });

  it('retains multi-color personality on mobile Light and Dark', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 760px)', css.indexOf('G04.2 VF-04')));
    for (const token of ['--pastel-page-lavender', '--pastel-page-peach', '--pastel-page-blush', '--pastel-page-sky']) expect(mobile).toContain(`var(${token})`);
    for (const token of ['--pastel-page-lavender', '--pastel-page-sky', '--pastel-page-mint', '--pastel-page-blush']) expect(mobile).toContain(`var(${token})`);
  });

  it('locks the authorized API source after the Attachment Optimizer V1 upload boundary', () => {
    expect(apiSha256).toBe('47c945a3b0e191ba86260c46e3b7fadbefd25a3b99675fbaf7b70fce1c39a3f1');
  });
});
