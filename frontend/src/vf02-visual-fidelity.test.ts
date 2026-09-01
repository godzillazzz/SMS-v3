import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(__dirname);
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.tsx');
const css = read('styles/visual-fidelity.css');
const dashboardPage = read('pages/dashboard/DashboardPage.tsx');
const dashboardHero = read('components/dashboard/DashboardHeroHeader.tsx');
const metrics = read('components/dashboard/MetricsGrid.tsx');
const quickActions = read('components/dashboard/QuickActionsCard.tsx');
const personnelHeader = read('components/personnel/PersonnelDirectoryHeader.tsx');
const accessPage = read('pages/access-management/AccessManagementPage.tsx');
const review = read('pages/access-management/RegistrationReviewPanel.tsx');
const apiBytes = fs.readFileSync(path.join(root, 'api.ts'), 'utf8').replace(/\r\n/g, '\n');
const apiSha256 = crypto.createHash('sha256').update(apiBytes).digest('hex');

describe('G04.2 VF-02 owner visual fidelity correction contract', () => {
  it('keeps one late visual authority after UX-01—UX-06 styles', () => {
    const foundation = main.indexOf("import './styles/theme-foundation.css';");
    const shell = main.indexOf("import './styles/app-shell.css';");
    const auth = main.indexOf("import './styles/auth-experience.css';");
    const vf = main.indexOf("import './styles/visual-fidelity.css';");
    expect(foundation).toBeGreaterThan(-1);
    expect(shell).toBeGreaterThan(foundation);
    expect(auth).toBeGreaterThan(shell);
    expect(vf).toBeGreaterThan(auth);
    expect((main.match(/visual-fidelity\.css/g) || []).length).toBe(1);
  });

  it('makes mobile Auth a true single-column composition with compact brand', () => {
    expect(main).toContain('className="auth-mobile-brand"');
    expect(css).toContain('.auth-experience-shell {\n    display: block !important;');
    expect(css).toContain('grid-template-columns: 1fr !important;');
    expect(css).toContain('.auth-brand-panel {\n    display: none !important;');
    expect(css).toContain('.auth-mobile-brand {\n    display: flex;');
    expect(css).toContain('.auth-form {\n    width: 100%;');
  });

  it('reserves shell space below the floating topbar on desktop and mobile', () => {
    expect(css).toContain('.content-area {\n    width: 100%;\n    min-width: 0;\n    padding: 24px 32px 44px;');
    expect(css).toContain('.content-area {\n    padding: 18px 14px 32px;');
    expect(css).toContain('scroll-padding-top: 104px;');
    expect(css).toContain('min-height: 66px;');
    expect(css).toContain('min-height: 60px;');
  });

  it('uses Thai-first Dashboard hierarchy with four premium KPIs and Quick Access before deeper summaries', () => {
    expect(dashboardHero).toContain('<h1>แดชบอร์ด</h1>');
    expect(dashboardHero).not.toContain('OPERATIONS CENTER');
    for (const label of ['กำลังปฏิบัติงาน', 'ลาวันนี้', 'รออนุมัติ', 'ต้องติดตาม']) expect(metrics).toContain(label);
    expect(metrics).not.toContain('EXECUTIVE SNAPSHOT');
    expect(dashboardPage).toContain('dashboard-top-row');
    expect(dashboardPage.indexOf('<QuickActionsCard')).toBeLessThan(dashboardPage.indexOf('dashboard-secondary-grid'));
    expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
    expect(css).toContain('min-height: 146px;');
  });

  it('reduces Dashboard nested boxes while keeping real support values and module navigation', () => {
    expect(css).toContain('/* Supporting values are one quiet rail, not four more cards. */');
    expect(css).toContain('.dashboard-today-highlight {\n  padding: 0 0 18px;\n  border: 0;');
    expect(css).toContain('.dashboard-shift-group,\n.dashboard-attention-row,\n.dashboard-expiring-row {');
    expect(css).toContain('border-radius: 0;');
    expect(quickActions).toContain("icon: 'employees'");
    expect(quickActions).toContain("icon: 'calendar'");
    expect(quickActions).toContain("icon: 'approval'");
    expect(quickActions).toContain("icon: 'license'");
    expect(quickActions).not.toMatch(/[⌕▤▥◈]/);
  });

  it('removes non-essential prototype eyebrows from representative product surfaces', () => {
    expect(personnelHeader).not.toContain('PERSONNEL OPERATIONS');
    expect(accessPage).not.toContain('ACCOUNT AND ACCESS MANAGEMENT');
    expect(accessPage).not.toContain('PENDING ACCOUNT APPROVAL');
    expect(review).not.toContain('REGISTRATION REVIEW');
    expect(review).not.toContain('REQUEST LIST');
    expect(review).not.toContain('APPLICANT SUBMISSION');
    expect(review).not.toContain('HUMAN REVIEW');
    expect(review).toContain('Employee Master');
  });

  it('allows the desktop Sidebar subtitle to wrap instead of truncating', () => {
    expect(css).toContain('.sidebar-brand span {');
    expect(css).toContain('text-overflow: clip;');
    expect(css).toContain('white-space: normal;');
    expect(css).toContain('min-height: 78px;');
  });

  it('keeps Personnel hierarchy spacious and Access summary adaptive', () => {
    expect(css).toContain('.personnel-summary-grid {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0,1fr));');
    expect(css).toContain('.personnel-metric {\n  min-height: 116px;');
    expect(css).toContain('.access-summary-grid {\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0,1fr));');
    expect(css).toContain('.access-summary-card {\n  min-height: 112px;');
  });

  it('puts Access Management first while preserving Registration Review workflow contracts', () => {
    const usersBlock = main.slice(main.indexOf("if (activePage === 'users')"), main.indexOf("if (activePage === 'settings')"));
    expect(usersBlock.indexOf('<AccessManagementPage')).toBeLessThan(usersBlock.indexOf('<RegistrationReviewPanel'));
    expect(review).toContain('api.matchRegistrationRequest(token, selected.id, employeeId)');
    expect(review).toContain('api.approveRegistrationRequest(token, selected.id)');
    expect(review).toContain('อนุมัติเป็น VIEWER');
    expect(review).toContain('role="dialog"');
    expect(review).not.toContain('window.prompt');
    expect(review).not.toContain('window.confirm');
  });

  it('reduces Registration Review to two parent surfaces with divider-led inner sections', () => {
    expect(css).toContain('.registration-review__requests,\n.registration-review__detail {');
    expect(css).toContain('.registration-review__summary,\n.registration-review__progress-wrap,\n.registration-review__employee-workspace,\n.registration-review__approval {');
    expect(css).toContain('background: transparent !important;');
    expect(css).toContain('.registration-review__comparison {');
    expect(css).toContain('border-radius: 15px;');
  });

  it('uses stronger Light ambience and the same deep layered Dark composition', () => {
    expect(css).toContain('rgba(135, 111, 242, .16)');
    expect(css).toContain('rgba(246, 164, 133, .12)');
    expect(css).toContain('rgba(221, 129, 180, .085)');
    expect(css).toContain('linear-gradient(180deg, #080d19 0%, #0b1120 58%, #090f1d 100%)');
    expect(css).not.toMatch(/neon/i);
  });

  it('keeps 390px mobile composition capability-oriented without preserving desktop density', () => {
    expect(css).toContain('@media (max-width: 520px)');
    expect(css).toContain('.dashboard-metrics {\n    grid-template-columns: 1fr;');
    expect(css).toContain('.dashboard-quick-actions__grid {\n    grid-template-columns: repeat(2, minmax(0,1fr));');
    expect(css).toContain('.personnel-summary-grid,\n  .access-summary-grid,\n  .access-summary-grid--manager {\n    grid-template-columns: 1fr;');
  });

  it('locks the authorized API source after the Attachment Optimizer V1 upload boundary', () => {
    expect(apiSha256).toBe('cf2716135db93c1911b4a296ecdadb5f0ea22fbd6745b4d13f079805ef879b48');
  });
});
