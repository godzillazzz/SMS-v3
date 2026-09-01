import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(__dirname);
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const css = read('styles/visual-fidelity.css');
const quick = read('components/dashboard/QuickActionsCard.tsx');
const access = read('pages/access-management/AccessManagementPage.tsx');
const review = read('pages/access-management/RegistrationReviewPanel.tsx');
const main = read('main.tsx');
const apiBytes = fs.readFileSync(path.join(root, 'api.ts'), 'utf8').replace(/\r\n/g, '\n');
const apiSha256 = crypto.createHash('sha256').update(apiBytes).digest('hex');
const vf06 = css.slice(css.indexOf('G04.2 VF-06'));

describe('G04.2 VF-06 final visual fidelity closure contract', () => {
  it('raises Dark signed-in Aurora environment without re-saturating KPI cards', () => {
    expect(vf06).toMatch(/\[data-theme="dark"\] \.content-area \{[\s\S]*?--color-primary\) 16%[\s\S]*?--color-info\) 10%[\s\S]*?--color-danger\) 8%[\s\S]*?--color-success\) 6%/);
    expect(vf06).toMatch(/\[data-theme="dark"\] \.dashboard-page-v2,[\s\S]*?--color-primary\) 13\.5%[\s\S]*?--color-info\) 9%[\s\S]*?--color-danger\) 7%[\s\S]*?--color-success\) 5\.5%/);
    expect(vf06).not.toMatch(/\[data-theme="dark"\] \.dashboard-metric\s*\{/);
    expect(css).toMatch(/\[data-theme="dark"\] \.dashboard-metric \{[\s\S]*?--vf03-accent\) 29%/);
  });

  it('harmonizes Dark shell reflections with the Aurora environment', () => {
    expect(vf06).toMatch(/\[data-theme="dark"\] \.sidebar \{[\s\S]*?--color-primary\) 29%[\s\S]*?--decorative-blush[\s\S]*?--decorative-sky/);
    expect(vf06).toMatch(/\[data-theme="dark"\] \.topbar \{[\s\S]*?--color-primary\) 23%[\s\S]*?--color-info\) 12%[\s\S]*?--color-danger\) 5\.5%/);
  });

  it('raises Dark Login atmosphere without changing accepted auth structure', () => {
    expect(vf06).toMatch(/\[data-theme="dark"\] \.auth-experience-page \{[\s\S]*?--color-primary\) 32%[\s\S]*?--color-info\) 18%[\s\S]*?--color-success\) 11%[\s\S]*?--decorative-blush/);
    expect(vf06).toMatch(/\[data-theme="dark"\] \.auth-brand-panel \{[\s\S]*?--color-primary\) 31%[\s\S]*?--color-info\) 17%[\s\S]*?--color-success\) 11%/);
    expect(main).toContain('className="auth-mobile-brand"');
    expect(main).toContain("await auth.login(email, password)");
  });

  it('makes only real Quick Access launchers visually richer', () => {
    expect(vf06).toMatch(/\[data-theme="dark"\] \.dashboard-quick-actions__grid button \{[\s\S]*?--quick-accent\) 30%[\s\S]*?--quick-accent\) 12%/);
    expect(vf06).toMatch(/\[data-theme="dark"\] \.dashboard-quick-actions__grid button > span \{[\s\S]*?--quick-accent\) 38%[\s\S]*?--quick-accent\) 31%/);
    for (const title of ['ข้อมูลพนักงาน', 'ตารางกะรายเดือน', 'รออนุมัติ', 'ใบอนุญาต รปภ.']) expect(quick).toContain(title);
    for (const fake of ['Payroll', 'Recruitment', 'Training', 'Benefits', 'เงินเดือน', 'สรรหา']) expect(quick).not.toContain(fake);
  });

  it('keeps Light surfaces white-first while increasing cross-product pastel continuity', () => {
    expect(vf06).toMatch(/\[data-theme="light"\] \.content-area \{[\s\S]*?--pastel-page-lavender\) 74%[\s\S]*?--pastel-page-sky\) 55%[\s\S]*?--pastel-page-blush\) 48%[\s\S]*?--pastel-page-peach\) 45%[\s\S]*?--pastel-page-mint\) 40%/);
    expect(vf06).toMatch(/\[data-theme="light"\] \.dashboard-primary-grid \{[\s\S]*?--decorative-mint[\s\S]*?--decorative-blush[\s\S]*?--decorative-cream/);
    expect(vf06).toMatch(/\[data-theme="light"\] \.dashboard-quick-actions \{[\s\S]*?--decorative-lavender[\s\S]*?--decorative-sky[\s\S]*?--decorative-peach/);
  });

  it('softens Registration Review passive rectangles while preserving workflow', () => {
    expect(vf06).toMatch(/\.registration-review__facts > div,[\s\S]*?border-color: color-mix\(in srgb, var\(--color-border\) 46%, transparent\)/);
    expect(vf06).toMatch(/\.registration-review__summary,[\s\S]*?\.registration-review__approval \{[\s\S]*?--color-border\) 58%/);
    expect(vf06).toMatch(/\[data-theme="light"\] \.registration-review__employee-workspace \{[\s\S]*?--decorative-mint\) 64%[\s\S]*?--decorative-lavender\) 50%/);
    expect(vf06).toMatch(/\[data-theme="dark"\] \.registration-review__employee-workspace \{[\s\S]*?--color-success\) 14%[\s\S]*?--color-primary\) 16%/);
    expect(review).toContain('api.matchRegistrationRequest(token, selected.id, employeeId)');
    expect(review).toContain('api.approveRegistrationRequest(token, selected.id)');
    expect(review).toContain('อนุมัติเป็น VIEWER');
    expect(review).not.toContain('window.prompt');
    expect(review).not.toContain('window.confirm');
  });

  it('retains Access five-card layout and security authority', () => {
    expect(css).toMatch(/@media \(min-width: 1181px\)[\s\S]*?\.access-summary-grid:not\(\.access-summary-grid--manager\)[\s\S]*?repeat\(5, minmax\(0, 1fr\)\)/);
    expect(access).toContain('visibleAccountActions(role, account, originalUserId)');
    expect(access).toContain('executeConfirmedViewAs');
  });

  it('carries stronger theme personality into accepted mobile architecture', () => {
    expect(vf06).toMatch(/@media \(max-width: 760px\)[\s\S]*?\[data-theme="dark"\] \.content-area \{[\s\S]*?--color-primary\) 18%[\s\S]*?--color-info\) 11%[\s\S]*?--color-danger\) 9%[\s\S]*?--color-success\) 6%/);
    expect(vf06).toMatch(/@media \(max-width: 760px\)[\s\S]*?\[data-theme="dark"\] \.auth-experience-page \{[\s\S]*?--color-primary\) 22%[\s\S]*?--color-info\) 13%[\s\S]*?--decorative-blush[\s\S]*?--color-success\) 7%/);
    expect(vf06).toMatch(/@media \(max-width: 760px\)[\s\S]*?\[data-theme="light"\] \.content-area[\s\S]*?--pastel-page-lavender[\s\S]*?--pastel-page-sky[\s\S]*?--pastel-page-blush[\s\S]*?--pastel-page-peach/);
  });

  it('locks the authorized API source after the Attachment Optimizer V1 upload boundary', () => {
    expect(apiSha256).toBe('a07381114e201646227ca9ed94d315652d4d50b64336c54769147145a6fedfcf');
  });
});
