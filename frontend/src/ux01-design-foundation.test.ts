import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const requiredTokens = [
  '--color-bg', '--color-surface', '--color-surface-elevated', '--color-surface-muted',
  '--color-text', '--color-text-secondary', '--color-text-muted', '--color-text-inverse',
  '--color-border', '--color-border-strong', '--color-primary', '--color-primary-hover',
  '--color-primary-active', '--color-primary-soft', '--color-success', '--color-success-soft',
  '--color-warning', '--color-warning-soft', '--color-attention', '--color-attention-soft',
  '--color-danger', '--color-danger-soft', '--color-info', '--color-info-soft', '--focus-ring',
  '--shadow-sm', '--shadow-md', '--shadow-lg', '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl',
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8',
  '--font-size-page-title', '--font-size-section-title', '--font-size-component-title', '--font-size-body',
  '--line-height-body', '--line-height-thai'
];

describe('G04.2 UX-01 design foundation contract', () => {
  const tokens = read('styles/tokens.css');
  const actions = read('styles/action-system.css');
  const legacyDesign = read('design-system.css');
  const foundation = read('styles/theme-foundation.css');
  const main = read('main.tsx');
  const themeControl = read('components/ThemeControl.tsx');
  const index = fs.readFileSync(path.resolve(root, '../index.html'), 'utf8');

  it('defines one complete semantic token vocabulary for both light and dark themes', () => {
    expect(tokens).toContain('[data-theme="light"]');
    expect(tokens).toContain('[data-theme="dark"]');
    requiredTokens.forEach((token) => expect(tokens).toContain(token));
    expect(tokens).toContain('--font-sans: "IBM Plex Sans Thai"');
    expect(tokens).toContain('--control-height: 40px');
    expect(main.indexOf("import './styles/tokens.css';")).toBeGreaterThan(main.indexOf("import './styles/action-system.css';"));
    expect(main.indexOf("import './styles/theme-foundation.css';")).toBeGreaterThan(main.indexOf("import './styles/tokens.css';"));
    expect(tokens).toContain('--sms-page: var(--color-bg)');
    expect(tokens).toContain('--sms-text: var(--color-text)');
    expect(tokens).toContain('--sms-indigo-600: var(--color-primary)');
    expect(legacyDesign).not.toContain(':root');
    expect(legacyDesign).toContain('Palette variables are provided by styles/tokens.css');
  });

  it('converges legacy action classes to the semantic primary/status vocabulary', () => {
    expect(actions).toContain('--sms-action-primary: var(--color-primary)');
    expect(actions).toMatch(/button\.btn-primary,[\s\S]*button\.btn-info[\s\S]*background: var\(--color-primary\)/);
    expect(actions).toContain('var(--color-success-soft)');
    expect(actions).toContain('var(--color-warning-soft)');
    expect(actions).toContain('var(--color-attention-soft)');
    expect(actions).toContain('var(--color-danger-soft)');
    expect(actions).toContain('.status-badge.info');
  });

  it('provides system/light/dark controls with local persistence and no page reload', () => {
    expect(themeControl).toContain("value: 'system'");
    expect(themeControl).toContain("value: 'light'");
    expect(themeControl).toContain("value: 'dark'");
    expect(themeControl).toContain('window.localStorage');
    expect(themeControl).toContain("window.matchMedia('(prefers-color-scheme: dark)')");
    expect(themeControl).not.toMatch(/location\.(reload|assign|replace)/);
    expect(index).toContain("localStorage.getItem('sms-v3-theme')");
    expect(index).toContain('document.documentElement.dataset.theme');
  });

  it('uses the consistent SVG icon system for global navigation instead of the former unicode navigation symbols', () => {
    const navigationBlock = main.slice(main.indexOf('const navigation:'), main.indexOf('function AuthProvider'));
    expect(main).toContain("import { SmsIcon, type SmsIconName }");
    expect(navigationBlock).toContain("icon: 'dashboard'");
    expect(navigationBlock).toContain("icon: 'employees'");
    expect(navigationBlock).toContain("icon: 'license'");
    expect(navigationBlock).not.toMatch(/[⌂♙▣▤◷▥⏳▧◌◈♧⚙]/u);
    expect(main).toContain('<SmsIcon name={item.icon}');
  });

  it('keeps focus, reduced motion and global interactive-size accessibility contracts', () => {
    expect(foundation).toContain('button:focus-visible');
    expect(foundation).toContain('box-shadow: var(--focus-ring)');
    expect(foundation).toContain('@media (prefers-reduced-motion: reduce)');
    expect(foundation).toContain('min-height: var(--control-height)');
    expect(themeControl).toContain('aria-pressed');
    expect(themeControl).toContain('aria-label');
  });

  it('preserves the certified G04.1 authentication and registration request/verification behavior', () => {
    expect(main).toContain('if (mode === \'login\') await auth.login(email, password)');
    expect(main).toContain('await requestRegistrationCode(false)');
    expect(main).toContain('api.requestRegistrationOtp({ submittedName: submittedName.trim(), email, password, departmentHint: departmentHint.trim() || undefined })');
    expect(main).toContain('api.verifyRegistrationOtp(email, code)');
    expect(main).toContain('setResendSeconds(60)');
    expect(main).toContain("if (next !== 'registerVerify') setResendSeconds(0)");
  });

  it('keeps applicant registration free of employee/role authority', () => {
    const login = main.slice(main.indexOf('function Login() {'), main.indexOf('\nconst text = ', main.indexOf('function Login() {')));
    expect(login).not.toContain('registrationEmployees');
    expect(login).not.toContain('available-employees');
    expect(login).not.toContain('employeeId');
    expect(login).not.toContain('employeeCode');
    expect(login).not.toMatch(/requestRegistrationOtp\(\{[^}]*role\s*:/s);
  });
});
