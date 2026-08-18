import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(__dirname);
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const css = read('styles/visual-fidelity.css');
const main = read('main.tsx');
const quick = read('components/dashboard/QuickActionsCard.tsx');
const access = read('pages/access-management/AccessManagementPage.tsx');
const review = read('pages/access-management/RegistrationReviewPanel.tsx');
const apiBytes = fs.readFileSync(path.join(root, 'api.ts'), 'utf8').replace(/\r\n/g, '\n');
const apiSha256 = crypto.createHash('sha256').update(apiBytes).digest('hex');
const vf05 = css.slice(css.indexOf('G04.2 VF-05'));

describe('G04.2 VF-05 final mockup fidelity closure contract', () => {
  it('adds shared Light pastel atmosphere beyond cards', () => {
    expect(vf05).toMatch(/\[data-theme="light"\] \.content-area \{[\s\S]*?--pastel-page-lavender[\s\S]*?--pastel-page-sky[\s\S]*?--pastel-page-blush[\s\S]*?--pastel-page-peach[\s\S]*?--pastel-page-mint/);
    expect(vf05).toMatch(/\[data-theme="light"\] \.dashboard-page-v2,[\s\S]*?\.personnel-directory-page,[\s\S]*?\.access-management-page,[\s\S]*?\.users-access-workspace/);
  });

  it('harmonizes signed-in Dark environment with Login calibration mood', () => {
    expect(vf05).toMatch(/\[data-theme="dark"\] \.content-area \{[\s\S]*?--color-primary\) 12%[\s\S]*?--color-info\) 7\.5%[\s\S]*?--color-danger\) 6%[\s\S]*?--color-success\) 4\.5%/);
    expect(vf05).toMatch(/\[data-theme="dark"\] \.topbar \{[\s\S]*?--color-primary\) 20%[\s\S]*?--color-info\) 10%/);
    expect(vf05).toMatch(/\[data-theme="dark"\] \.sidebar \{[\s\S]*?--color-primary\) 25%[\s\S]*?--decorative-blush[\s\S]*?--decorative-sky/);
  });

  it('keeps KPI saturation at VF-04 while improving surrounding depth', () => {
    expect(css).toMatch(/\[data-theme="dark"\] \.dashboard-metric \{[\s\S]*?--vf03-accent\) 29%/);
    expect(vf05).not.toMatch(/\[data-theme="dark"\] \.dashboard-metric\s*\{/);
    expect(vf05).toMatch(/\[data-theme="dark"\] \.dashboard-today-operations,[\s\S]*?\.dashboard-attention,[\s\S]*?\.dashboard-quick-actions/);
  });

  it('makes real Quick Access launchers richer without fake modules', () => {
    expect(vf05).toMatch(/\[data-theme="dark"\] \.dashboard-quick-actions__grid button \{[\s\S]*?--quick-accent\) 24%/);
    expect(vf05).toMatch(/\[data-theme="dark"\] \.dashboard-quick-actions__grid button > span \{[\s\S]*?--quick-accent\) 32%/);
    expect(vf05).toMatch(/\.dashboard-quick-actions__grid button:hover,[\s\S]*?transform: translateY\(-2px\)/);
    for (const title of ['ข้อมูลพนักงาน', 'ตารางกะรายเดือน', 'รออนุมัติ', 'ใบอนุญาต รปภ.']) expect(quick).toContain(title);
    for (const fake of ['Payroll', 'Recruitment', 'Training', 'Benefits', 'เงินเดือน', 'สรรหา']) expect(quick).not.toContain(fake);
  });

  it('preserves balanced Access 5-KPI desktop layout and authority logic', () => {
    expect(css).toMatch(/@media \(min-width: 1181px\)[\s\S]*?\.access-summary-grid:not\(\.access-summary-grid--manager\)[\s\S]*?repeat\(5, minmax\(0, 1fr\)\)/);
    expect(access).toContain('visibleAccountActions(role, account, originalUserId)');
    expect(access).toContain('executeConfirmedViewAs');
  });

  it('softens Registration Review passive boxes while preserving workflow semantics', () => {
    expect(vf05).toMatch(/\.registration-review__facts > div,[\s\S]*?\.registration-review__compare-grid dl > div \{[\s\S]*?border-color: color-mix[\s\S]*?box-shadow: none/);
    expect(vf05).toMatch(/\.registration-review__search input \{[\s\S]*?border-color: color-mix[\s\S]*?background: color-mix/);
    expect(vf05).toMatch(/\[data-theme="light"\] \.registration-review__employee-workspace \{[\s\S]*?--decorative-mint[\s\S]*?--decorative-lavender/);
    expect(vf05).toMatch(/\[data-theme="dark"\] \.registration-review__employee-workspace \{[\s\S]*?--color-success[\s\S]*?--color-primary/);
    expect(review).toContain('api.matchRegistrationRequest(token, selected.id, employeeId)');
    expect(review).toContain('api.approveRegistrationRequest(token, selected.id)');
    expect(review).toContain('อนุมัติเป็น VIEWER');
    expect(review).not.toContain('window.prompt');
    expect(review).not.toContain('window.confirm');
  });

  it('retains accepted navigation/auth architecture and mobile atmosphere only changes presentation', () => {
    expect(main).toContain("id: 'dashboard'");
    expect(main).toContain("id: 'employees'");
    expect(main).toContain("id: 'users'");
    expect(main).toContain('className="auth-mobile-brand"');
    expect(vf05).toMatch(/@media \(max-width: 760px\)[\s\S]*?\[data-theme="light"\] \.content-area[\s\S]*?--pastel-page-lavender[\s\S]*?--pastel-page-sky[\s\S]*?--pastel-page-blush[\s\S]*?--pastel-page-peach/);
    expect(vf05).toMatch(/@media \(max-width: 760px\)[\s\S]*?\[data-theme="dark"\] \.content-area[\s\S]*?--color-primary[\s\S]*?--color-info[\s\S]*?--color-danger[\s\S]*?--color-success/);
  });

  it('keeps frontend/src/api.ts byte-equivalent to the frozen baseline', () => {
    expect(apiSha256).toBe('3edef237bf89ab63272c22caa7069e68eb542be278a82e44f6d810fd64bf16b7');
  });
});
