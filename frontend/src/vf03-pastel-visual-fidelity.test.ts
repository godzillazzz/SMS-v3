import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(__dirname);
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.tsx');
const tokens = read('styles/tokens.css');
const css = read('styles/visual-fidelity.css');
const dataCss = read('styles/data-surfaces.css');
const metrics = read('components/dashboard/MetricsGrid.tsx');
const quickActions = read('components/dashboard/QuickActionsCard.tsx');
const personnel = read('pages/personnel/PersonnelDirectoryPage.tsx');
const access = read('pages/access-management/AccessManagementPage.tsx');
const review = read('pages/access-management/RegistrationReviewPanel.tsx');
const apiBytes = fs.readFileSync(path.join(root, 'api.ts'), 'utf8').replace(/\r\n/g, '\n');
const apiSha256 = crypto.createHash('sha256').update(apiBytes).digest('hex');

describe('G04.2 VF-03 colorful pastel + midnight dark visual contract', () => {
  it('defines one shared pastel family and semantic accent surfaces in the authoritative token layer', () => {
    for (const token of [
      '--pastel-lavender-100', '--pastel-blush-100', '--pastel-peach-100',
      '--pastel-mint-100', '--pastel-sky-100', '--pastel-cream-100'
    ]) expect(tokens).toContain(token);
    for (const token of [
      '--surface-accent-primary', '--surface-accent-success', '--surface-accent-warning',
      '--surface-accent-attention', '--surface-accent-danger', '--surface-accent-info'
    ]) expect((tokens.match(new RegExp(token, 'g')) || []).length).toBeGreaterThanOrEqual(2);
    for (const token of ['--pastel-page-lavender', '--pastel-page-blush', '--pastel-page-peach', '--pastel-page-mint', '--pastel-page-sky']) {
      expect(tokens).toContain(token);
    }
  });

  it('keeps one late VF authority instead of adding a competing VF stylesheet', () => {
    expect((main.match(/visual-fidelity\.css/g) || []).length).toBe(1);
    expect(main).not.toContain('vf03-pastel.css');
    expect(css).toContain('G04.2 VF-03');
    expect(css).toContain('pastel colorful visual fidelity correction');
  });

  it('renders broad multi-family ambience in both Light and Midnight Dark', () => {
    for (const token of ['--pastel-page-lavender', '--pastel-page-blush', '--pastel-page-peach', '--pastel-page-mint', '--pastel-page-sky']) {
      expect(css).toContain(`var(${token})`);
    }
    expect(css).toContain('[data-theme="light"] body');
    expect(css).toContain('[data-theme="dark"] body');
    expect(css).toContain('var(--color-bg)');
  });

  it('maps the four real Dashboard KPIs to mint, sky, cream and blush identities', () => {
    expect(metrics).toContain('label="กำลังปฏิบัติงาน"');
    expect(metrics).toContain('tone="green"');
    expect(metrics).toContain('label="ลาวันนี้"');
    expect(metrics).toContain('tone="teal"');
    expect(metrics).toContain('label="รออนุมัติ"');
    expect(metrics).toContain('tone="warning"');
    expect(metrics).toContain('label="ต้องติดตาม"');
    expect(metrics).toContain('tone="urgent"');
    expect(css).toMatch(/\.dashboard-metric--green\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-success\)/s);
    expect(css).toMatch(/\.dashboard-metric--teal\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-info\)/s);
    expect(css).toMatch(/\.dashboard-metric--warning\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-warning\)/s);
    expect(css).toMatch(/\.dashboard-metric--urgent\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-danger\)/s);
  });

  it('gives real Quick Access modules distinct restrained pastel accents without inventing modules', () => {
    for (const title of ['ข้อมูลพนักงาน', 'ตารางกะรายเดือน', 'รออนุมัติ', 'ใบอนุญาต รปภ.']) expect(quickActions).toContain(title);
    for (const fake of ['Payroll', 'Recruitment', 'Training', 'Benefits', 'เงินเดือน', 'สรรหา']) expect(quickActions).not.toContain(fake);
    for (const index of [1, 2, 3, 4]) expect(css).toContain(`.dashboard-quick-actions__grid button:nth-child(${index})`);
    expect(css).toContain('--quick-wash: var(--decorative-lavender)');
    expect(css).toContain('--quick-wash: var(--decorative-mint)');
    expect(css).toContain('--quick-wash: var(--decorative-cream)');
    expect(css).toContain('--quick-wash: var(--decorative-blush)');
  });

  it('keeps Personnel business behavior while giving its three real metrics distinct pastel identities', () => {
    expect(personnel).toContain('pageSize = 10');
    expect(personnel).toContain('label="บุคลากรทั้งหมด"');
    expect(personnel).toContain('tone="indigo"');
    expect(personnel).toContain('label="บุคลากรที่ใช้งาน"');
    expect(personnel).toContain('tone="green"');
    expect(personnel).toContain('label="โปรไฟล์ไม่สมบูรณ์"');
    expect(personnel).toContain('tone="amber"');
    expect(css).toMatch(/\.personnel-metric\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-primary\)/s);
    expect(css).toMatch(/\.personnel-metric--green\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-success\)/s);
    expect(css).toMatch(/\.personnel-metric--amber\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-warning\)/s);
  });

  it('gives Access summary states distinct pastel identities without changing action authority', () => {
    for (const tone of ['indigo', 'green', 'amber', 'red', 'purple']) expect(access).toContain(`tone: '${tone}'`);
    expect(css).toMatch(/\.access-summary-card\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-primary\)/s);
    expect(css).toMatch(/\.access-summary-card--green\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-success\)/s);
    expect(css).toMatch(/\.access-summary-card--amber\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-warning\)/s);
    expect(css).toMatch(/\.access-summary-card--red\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-danger\)/s);
    expect(css).toMatch(/\.access-summary-card--purple\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-attention\)/s);
    expect(access).toContain('visibleAccountActions(role, account, originalUserId)');
    expect(access).toContain('executeConfirmedViewAs');
  });

  it('uses semantic pastel request states while preserving Registration Review workflow exactly', () => {
    expect(review).toContain('registration-review__request--${requestTone[row.status]');
    for (const tone of ['warning', 'info', 'success', 'danger']) expect(css).toContain(`.registration-review__request--${tone}`);
    expect(review).toContain('api.matchRegistrationRequest(token, selected.id, employeeId)');
    expect(review).toContain('api.approveRegistrationRequest(token, selected.id)');
    expect(review).toContain('อนุมัติเป็น VIEWER');
    expect(review).toContain('role="dialog"');
    expect(review).not.toContain('window.prompt');
    expect(review).not.toContain('window.confirm');
  });

  it('keeps a decorative Auth hero while retaining VF-02 true single-column mobile behavior after the Owner shield correction', () => {
    expect(main).toContain('className="auth-pastel-illustration auth-security-shield-scene" aria-hidden="true"');
    expect(main).toContain('className="auth-security-shield"');
    expect(main).not.toContain('auth-security-core-scene');
    expect(main).not.toContain('auth-pastel-shield');
    expect(main).toContain('className="auth-mobile-brand"');
    expect(css).toContain('G04.2 VF-07');
    expect(css).toContain('.auth-security-shield__outer');
    expect(css).toContain('.auth-security-shield__lock-body');
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.auth-security-shield-scene,[\s\S]*?display:\s*none !important;/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.auth-brand-panel\s*\{\s*display:\s*none !important;/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.auth-experience-shell\s*\{[\s\S]*?grid-template-columns:\s*1fr !important;/);
  });

  it('keeps decorative pastel separate from semantic status truth', () => {
    expect(tokens).toContain('--color-success-soft: #ecfaf5');
    expect(tokens).toContain('--color-warning-soft: #fff6dc');
    expect(tokens).toContain('--color-attention-soft: #fff0e7');
    expect(tokens).toContain('--color-danger-soft: #fff1f6');
    expect(tokens).toContain('--color-info-soft: #effafe');
    for (const tone of ['success', 'warning', 'attention', 'danger', 'info']) expect(dataCss).toContain(`.status-badge--${tone}`);
  });

  it('locks the authorized API source after the Attachment Optimizer V1 upload boundary', () => {
    expect(apiSha256).toBe('cf2716135db93c1911b4a296ecdadb5f0ea22fbd6745b4d13f079805ef879b48');
  });
});
