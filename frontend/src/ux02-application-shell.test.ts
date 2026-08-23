import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const expectedNavigationIds = [
  'dashboard', 'employees', 'licenses', 'attendanceDevice', 'schedule', 'shiftSetup', 'leave', 'leavePending',
  'leaveHistory', 'quota', 'rules', 'audit', 'dataQuality', 'users', 'reportCenter', 'settings'
];

describe('G04.2 UX-02 application shell contract', () => {
  const main = read('main.tsx');
  const shell = read('styles/app-shell.css');
  const tokens = read('styles/tokens.css');
  const responsive = read('styles/responsive-shell.css');
  const dashboard = read('styles/dashboard.css');
  const design = read('design-system.css');
  const foundation = read('styles/theme-foundation.css');
  const icons = read('components/SmsIcon.tsx');
  const themeControl = read('components/ThemeControl.tsx');
  const navigationBlock = main.slice(main.indexOf('const navigation:'), main.indexOf('function AuthProvider'));

  it('keeps the existing navigation page IDs and adds only the authorized G06 device page', () => {
    const ids = Array.from(navigationBlock.matchAll(/id: '([^']+)'/g), (match) => match[1]);
    expect(ids).toEqual(expectedNavigationIds);
  });

  it('keeps navigation role filtering unchanged', () => {
    expect(main).toContain("if (page === 'leavePending') return ['ADMIN', 'MANAGER'].includes(auth.user?.role || '')");
    expect(main).toContain("if (page === 'audit') return auth.user?.role === 'ADMIN'");
    expect(main).toContain("if (page === 'dataQuality') return auth.user?.role === 'ADMIN'");
    expect(main).toContain("if (page === 'settings') return auth.user?.role === 'ADMIN'");
    expect(main).toContain("if (page === 'users') return ['ADMIN', 'MANAGER'].includes(auth.user?.role || '')");
    expect(main).toContain("if (page === 'quota') return auth.user?.role === 'ADMIN'");
    expect(main).toContain("if (['licenses', 'reportCenter', 'reports', 'executiveReport'].includes(page)) return ['ADMIN', 'MANAGER'].includes(auth.user?.role || '')");
  });

  it('uses SmsIcon line SVGs for shell navigation and utility controls', () => {
    expect(main).toContain('<SmsIcon name={item.icon} size={19} />');
    expect(main).toContain('<SmsIcon name="menu" size={20} />');
    expect(main).toContain('<SmsIcon name="more" size={20} />');
    expect(main).toContain('<SmsIcon name="close" size={20} />');
    expect(icons).toContain("| 'more' | 'close' | 'logout'");
    expect(navigationBlock).not.toMatch(/[⌂♙▣▤◷▥⏳▧◌◈♧⚙]/u);
  });

  it('keeps desktop theme control as System Light Dark with persistent preference', () => {
    expect(themeControl).toContain("value: 'system'");
    expect(themeControl).toContain("value: 'light'");
    expect(themeControl).toContain("value: 'dark'");
    expect(themeControl).toContain('persistThemePreference(preference, window.localStorage)');
    expect(main).not.toContain('<div className="sidebar-theme-block">');
    expect(main).toContain('<ThemeControl compact />');
    expect(main).toContain('className="mobile-utility-theme"');
  });

  it('keeps theme selection frontend-only and does not reload application state', () => {
    expect(themeControl).toContain("window.matchMedia('(prefers-color-scheme: dark)')");
    expect(themeControl).not.toMatch(/location\.(reload|assign|replace)/);
    expect(themeControl).not.toContain('api.');
  });

  it('implements accessible mobile drawer open close Escape and focus return', () => {
    expect(main).toContain('aria-expanded={mobileMenuOpen}');
    expect(main).toContain('aria-controls="app-navigation-drawer"');
    expect(main).toContain('id="app-navigation-drawer"');
    expect(main).toContain("if (event.key === 'Escape') setMobileMenuOpen(false)");
    expect(main).toContain('mobileMenuTriggerRef.current?.focus()');
    expect(main).toContain('const releaseScrollLock = acquireDocumentScrollLock()');
    expect(main).toContain('releaseScrollLock()');
    expect(main).toContain('className="sidebar-overlay"');
    expect(main).toContain('className="sidebar-close-button"');
  });

  it('keeps mobile access to search profile theme and logout', () => {
    const mobilePanel = main.slice(main.indexOf('id="mobile-utility-panel"'), main.indexOf('</header>', main.indexOf('id="mobile-utility-panel"')));
    expect(mobilePanel).toContain('mobile-utility-profile');
    expect(mobilePanel).toContain('mobile-utility-search');
    expect(mobilePanel).toContain('<ThemeControl />');
    expect(mobilePanel).toContain('auth.logout()');
    expect(main).toContain('aria-expanded={mobileUtilityOpen}');
    expect(main).toContain("if (event.key === 'Escape') setMobileUtilityOpen(false)");
    expect(main).toContain('mobileUtilityTriggerRef.current?.focus()');
    expect(main).toContain('mobileUtilityOpen && createPortal(<>');
    expect(main).toContain('</>, document.body)');
    const utilityEffect = main.slice(main.indexOf('if (!mobileUtilityOpen) return;'), main.indexOf('}, [mobileUtilityOpen]);'));
    expect(utilityEffect).toContain('acquireDocumentScrollLock()');
    expect(utilityEffect).toContain('releaseScrollLock()');
  });

  it('preserves business page routing and search navigation behavior', () => {
    expect(main).toContain("const parentPage: Partial<Record<Page, Page>> = { executiveReport: 'reportCenter', reports: 'reportCenter' }");
    expect(main).toContain("if (event.target.value && activePage !== 'employees') setActivePage('employees')");
    expect(main).not.toContain('Ctrl+K');
    expect(main).not.toContain('Meta+K');
  });

  it('preserves certified authentication and registration behavior', () => {
    expect(main).toContain("if (mode === 'login') await auth.login(email, password)");
    expect(main).toContain('api.requestRegistrationOtp({ submittedName: submittedName.trim(), email, password, departmentHint: departmentHint.trim() || undefined })');
    expect(main).toContain('api.verifyRegistrationOtp(email, code)');
    expect(main).toContain('setResendSeconds(60)');
  });

  it('owns tablet drawer behavior in app-shell without legacy responsive competition', () => {
    expect(shell).toContain('@media (max-width: 1024px)');
    expect(shell).toMatch(/\.sidebar\s*\{[\s\S]*position: fixed !important;[\s\S]*transform: translateX/);
    expect(shell).toContain('.sidebar.open');
    expect(shell).toContain('.sidebar-overlay');
    expect(responsive).not.toContain('.sidebar {');
    expect(responsive).not.toContain('.topbar {');
    expect(foundation).toContain('Application shell ownership moved to styles/app-shell.css');
    expect(design).toContain('Application frame ownership moved to styles/app-shell.css');
    expect(dashboard).not.toMatch(/\.sidebar\s*\{/);
  });

  it('does not surface fake notification functionality', () => {
    expect(main).not.toContain('aria-label="การแจ้งเตือน"');
    expect(main).not.toContain('title="การแจ้งเตือน"');
    expect(main).not.toContain('<SmsIcon name="bell"');
    expect(main).not.toContain('topbar-icon');
  });

  it('uses one semantic light dark shell system with final shell import ownership', () => {
    expect(tokens).toContain('--color-sidebar-bg: #fcfbfd');
    expect(tokens).toContain('--color-sidebar-bg-strong: #ffffff');
    expect(tokens).toContain('--color-sidebar-bg: #0b1020');
    expect(tokens).toContain('--color-sidebar-bg-strong: #070b14');
    expect(shell).toContain('var(--color-sidebar-bg)');
    expect(shell).toContain('var(--color-surface-translucent)');
    expect(shell).toContain('var(--color-primary-soft)');
    expect(shell).toContain('[data-theme="dark"] .sidebar');
    expect(main.indexOf("import './styles/app-shell.css';")).toBeGreaterThan(main.indexOf("import './styles/theme-foundation.css';"));
  });
});
