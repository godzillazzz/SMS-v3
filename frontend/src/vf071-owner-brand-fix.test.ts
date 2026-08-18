import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(__dirname);
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.tsx');
const css = read('styles/visual-fidelity.css');
const report = read('pages/executive-report/ExecutiveReportCenterPage.tsx');
const reportCenter = read('pages/reports/ReportCenterPage.tsx');
const theme = read('theme.ts');
const index = fs.readFileSync(path.resolve(root, '../index.html'), 'utf8');
const apiBytes = fs.readFileSync(path.join(root, 'api.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('G04.2 VF-07.1 Owner brand + login hero correction', () => {
  it('renders the same approved SMS tile across desktop, login and mobile brand surfaces', () => {
    expect(main).toContain('function Logo()');
    expect(main).toContain('className="brand-mark" aria-label="SMS"><b>SMS</b>');
    expect(main).toContain('className="intro-brand auth-brand"');
    expect(main).toContain('className="auth-mobile-brand"');
    expect(main).toContain('className="sidebar-brand"');
    expect(main).toContain('className="mobile-brand"');
    expect(main).not.toContain('<SmsIcon name="shield" size={18} /><b>SMS</b>');
  });

  it('removes V3 from user-visible frontend branding and report presentation', () => {
    expect(main).not.toMatch(/SMS V3|SMS v3/);
    expect(report).not.toMatch(/SECURITY MANAGEMENT SYSTEM V3|SMS-V3 Executive Report|SMS-V3-Executive-Report/);
    expect(reportCenter).not.toContain('SMS-V3-Executive-Report');
    expect(report).toContain('SECURITY MANAGEMENT SYSTEM');
    expect(report).toContain('SMS Executive Report');
    expect(reportCenter).toContain('SMS-Executive-Report');
  });

  it('preserves internal technical V3 identifiers used by theme persistence', () => {
    expect(theme).toContain("THEME_STORAGE_KEY = 'sms-v3-theme'");
    expect(index).toContain("localStorage.getItem('sms-v3-theme')");
  });

  it('keeps exact vertically symmetric shield and centered lock geometry', () => {
    expect(main).toContain('M210 46 L304 82 V145 C304 207 266 246 210 266 C154 246 116 207 116 145 V82 Z');
    expect(main).toContain('M210 66 L282 92 V145 C282 193 253 224 210 242 C167 224 138 193 138 145 V92 Z');
    expect(main).toContain('M210 86 L260 104 V144 C260 177 241 199 210 214 C179 199 160 177 160 144 V104 Z');
    expect(main).toContain('x="181" y="142" width="58" height="47"');
    expect(main).toContain('cx="210" cy="162"');
    expect(main).toContain('cx="69" cy="135"');
    expect(main).toContain('cx="351" cy="135"');
  });

  it('removes the old core DOM/CSS and keeps the desktop shield out of mobile Auth', () => {
    expect(main).not.toContain('auth-security-core-scene');
    expect(main).not.toContain('className="auth-security-core"');
    expect(css).not.toContain('.auth-security-core__facet');
    expect(css).not.toContain('.auth-security-core__architecture');
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.auth-security-shield-scene,[\s\S]*?display: none !important/);
  });

  it('removes only the duplicate signed-in sidebar theme presentation', () => {
    expect(main).not.toContain('sidebar-theme-block');
    expect(main).toContain('<ThemeControl compact />');
    expect(main).toContain('mobile-utility-theme');
    expect(main).toContain('sidebar-user sidebar-profile');
    expect(main).toContain('sidebar-logout');
  });

  it('locks the reusable SMS tile to exact shared centered geometry', () => {
    expect(css).toContain('G04.2 VF-07.1 V2 — Owner exact SMS logo geometry lock');
    expect(css).toMatch(/\.brand-mark \{[\s\S]*?position: relative;[\s\S]*?display: inline-grid !important;[\s\S]*?place-items: center !important;/);
    expect(css).toMatch(/\.brand-mark > b \{[\s\S]*?top: 50%;[\s\S]*?left: 50%;[\s\S]*?transform: translate\(-50%, -50%\);[\s\S]*?color: #fff !important;[\s\S]*?line-height: 1;/);
    expect(css).toMatch(/\.sidebar-brand \.brand-mark \{[\s\S]*?margin-top: 0;/);
  });
  it('keeps the API hard gate byte-equivalent', () => {
    expect(crypto.createHash('sha256').update(apiBytes).digest('hex')).toBe('3edef237bf89ab63272c22caa7069e68eb542be278a82e44f6d810fd64bf16b7');
  });
});