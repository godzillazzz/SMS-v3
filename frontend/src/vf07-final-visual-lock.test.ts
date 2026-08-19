import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(__dirname);
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.tsx');
const css = read('styles/visual-fidelity.css');
const quick = read('components/dashboard/QuickActionsCard.tsx');
const access = read('pages/access-management/AccessManagementPage.tsx');
const review = read('pages/access-management/RegistrationReviewPanel.tsx');
const theme = read('theme.ts');
const apiBytes = fs.readFileSync(path.join(root, 'api.ts'), 'utf8').replace(/\r\n/g, '\n');
const apiSha256 = crypto.createHash('sha256').update(apiBytes).digest('hex');
const vf07 = css.slice(css.indexOf('G04.2 VF-07'));

describe('G04.2 VF-07 visual baseline with Owner brand correction', () => {
  it('uses the Owner symmetric holographic shield and removes the Aurora Security Core', () => {
    expect(main).toContain('auth-security-shield-scene');
    expect(main).toContain('className="auth-security-shield"');
    expect(main).toContain('security-shield-outer');
    expect(main).toContain('auth-security-shield__outer');
    expect(main).toContain('auth-security-shield__middle');
    expect(main).toContain('auth-security-shield__inner');
    expect(main).toContain('auth-security-shield__lock-body');
    expect(main).toContain('auth-security-shield__orbits');
    expect(main).toContain('auth-security-shield__nodes');
    expect(main).toContain('M210 46 L304 82 V145 C304 207 266 246 210 266 C154 246 116 207 116 145 V82 Z');
    expect(main).not.toContain('auth-security-core-scene');
    expect(main).not.toContain('className="auth-security-core"');
    expect(main).not.toContain('auth-pastel-shield');
  });

  it('uses one purple SMS tile and removes V3 from rendered brand lockups', () => {
    expect(main).toContain('function Logo()');
    expect(main).toContain('className="brand-mark" aria-label="SMS"><b>SMS</b>');
    expect(main).not.toMatch(/SMS V3|SMS v3/);
    expect(main).toContain('<strong>Security Management System</strong>');
    for (const capability of ['ข้อมูลบุคลากร', 'ตารางกะและการลา', 'สิทธิ์และกฎการทำงาน']) expect(main).toContain(capability);
    expect(css).toContain('background: linear-gradient(145deg, #8d6cf2 0%, #6e55dc 56%, #5740c9 100%)');
  });

  it('implements the Owner shield with internal SVG/CSS only', () => {
    expect(main).toContain('<svg className="auth-security-shield"');
    expect(main).toContain('<linearGradient id="security-shield-outer"');
    expect(main).toContain('<radialGradient id="security-shield-inner"');
    expect(main).toContain('<feGaussianBlur stdDeviation="14" />');
    expect(vf07).toContain('.auth-security-shield__bloom');
    expect(vf07).toContain('.auth-security-shield__lock-shackle');
    expect(vf07).not.toMatch(/https?:\/\//);
    expect(vf07).not.toMatch(/base64/i);
  });

  it('uses one shield geometry with pastel Light and Aurora Dark lighting', () => {
    expect(vf07).toMatch(/auth-security-shield__stop--lavender[\s\S]*?#d9ceff/);
    expect(vf07).toMatch(/auth-security-shield__stop--mint[\s\S]*?#a8e5cf/);
    expect(vf07).toMatch(/\[data-theme="dark"\] \.auth-security-shield[\s\S]*?drop-shadow[\s\S]*?--color-info/);
    expect(vf07).toMatch(/\[data-theme="dark"\] \.auth-security-shield__bloom[\s\S]*?--color-primary[\s\S]*?--color-info/);
    expect(vf07).not.toMatch(/cyberpunk|neon|rgb\(/i);
  });

  it('preserves accepted single-column mobile Auth and hides the desktop shield', () => {
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.auth-brand-panel \{[\s\S]*?display: none !important/);
    expect(vf07).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.auth-security-shield-scene,[\s\S]*?\.auth-security-shield \{[\s\S]*?display: none !important/);
    expect(main).toContain('className="auth-mobile-brand"');
  });

  it('does not change authentication, registration or password-reset behavior', () => {
    expect(main).toContain('await auth.login(email, password)');
    expect(main).toContain('api.requestRegistrationOtp');
    expect(main).toContain('api.verifyRegistrationOtp(email, code)');
    expect(main).toContain('api.requestPasswordResetOtp(email)');
    expect(main).toContain('api.completePasswordReset(email, code, password)');
  });

  it('keeps only the real Quick Access modules and their count stable', () => {
    for (const title of ['ข้อมูลพนักงาน', 'ตารางกะรายเดือน', 'รออนุมัติ', 'ใบอนุญาต รปภ.']) expect(quick).toContain(title);
    for (const fake of ['Payroll', 'Recruitment', 'Training', 'Benefits', 'เงินเดือน', 'สรรหา']) expect(quick).not.toContain(fake);
    const entries = quick.match(/title: '/g) || [];
    expect(entries.length).toBe(4);
  });

  it('preserves the Access five-KPI desktop row and account authority', () => {
    expect(css).toMatch(/@media \(min-width: 1181px\)[\s\S]*?\.access-summary-grid:not\(\.access-summary-grid--manager\)[\s\S]*?repeat\(5, minmax\(0, 1fr\)\)/);
    for (const label of ['บัญชีทั้งหมด', 'ใช้งานอยู่', 'รออนุมัติ', 'ระงับใช้งาน', 'ต้องรีเซ็ตรหัสผ่าน']) expect(access).toContain(label);
    expect(access).toContain('visibleAccountActions(role, account, originalUserId)');
    expect(access).toContain('executeConfirmedViewAs');
  });

  it('preserves explicit Registration Review workflow and VIEWER approval', () => {
    expect(review).toContain('api.registrationCandidates(token, selected.id');
    expect(review).toContain('setSelectedCandidateId(candidate.id)');
    expect(review).toContain('เปรียบเทียบก่อนจับคู่');
    expect(review).toContain('api.matchRegistrationRequest(token, selected.id, employeeId)');
    expect(review).toContain('api.approveRegistrationRequest(token, selected.id)');
    expect(review).toContain('อนุมัติเป็น VIEWER');
    expect(review).not.toContain('autoMatch');
  });

  it('keeps top/mobile theme behavior while removing the duplicate desktop sidebar theme block', () => {
    expect(theme).toContain("export type ThemePreference = 'system' | 'light' | 'dark'");
    expect(main).not.toContain('<div className="sidebar-theme-block">');
    expect(main).toContain('<ThemeControl compact />');
    expect(main).toContain('className="mobile-utility-theme"');
    expect(css).toMatch(/G04\.2 VF-06[\s\S]*?\[data-theme="dark"\] \.content-area/);
    expect(css).toMatch(/G04\.2 VF-06[\s\S]*?\[data-theme="light"\] \.content-area/);
  });

  it('locks the authorized V1.2 API source after the Passkey extension', () => {
    expect(apiSha256).toBe('0ee0ee4f9b9acff7b82febbc64a7abafa5417d713a825c30e973e0c1196f078f');
  });
});