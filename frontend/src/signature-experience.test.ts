import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.tsx');
const css = read('styles/signature-experience.css');
const drawer = read('components/OperationalRecordDrawer.tsx');
const access = read('pages/access-management/AccessManagementPage.tsx');
const dashboard = read('pages/dashboard/DashboardPage.tsx');
const theme = read('components/ThemeControl.tsx');

describe('SMS Signature Experience V1 regression contract', () => {
  it('owns the final visual layer without replacing the accepted brand foundation', () => {
    expect(main).toContain("import './styles/signature-experience.css';");
    expect(main.indexOf("import './styles/signature-experience.css';")).toBeGreaterThan(main.indexOf("import './styles/visual-fidelity.css';"));
    expect(main).toContain('<span className="brand-mark" aria-label="SMS"><b>SMS</b></span>');
    expect(main).not.toMatch(/<[^>]*>\s*SMS V3\s*</i);
    expect(css).not.toMatch(/neon/i);
  });

  it('defines portable Light and flagship Dark table tokens and prevents accidental light dark rows', () => {
    for (const token of ['--table-bg', '--table-header-bg', '--table-row-bg', '--table-row-hover-bg', '--table-border', '--table-text-primary', '--table-text-secondary']) {
      expect(css).toContain(token);
    }
    expect(css).toContain('[data-theme="light"]');
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('[data-theme="dark"] .data-surface-table tbody tr');
    expect(css).toContain('background-color: var(--table-row-bg) !important;');
    expect(css).toContain('background: var(--table-header-bg) !important;');
  });

  it('makes operational rows inspectable by pointer and keyboard before common actions', () => {
    expect(main).toContain('className="signature-data-row"');
    expect(main).toContain('tabIndex={0}');
    expect(main).toContain("event.key === 'Enter' || event.key === ' '");
    expect(main).toContain('selectRow(row)');
    expect(main).toContain('<OperationalRecordDrawer');
    expect(main).toContain("label: 'จัดการใบอนุญาตและเอกสาร'");
    expect(main).toContain("label: 'แก้ไขโควตา'");
  });

  it('keeps drawer focus management, ESC close and mobile full-height detail semantics', () => {
    expect(drawer).toContain("event.key === 'Escape'");
    expect(drawer).toContain("event.key !== 'Tab'");
    expect(drawer).toContain('role="dialog"');
    expect(drawer).toContain('aria-modal="true"');
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.signature-record-drawer \{[\s\S]*?width: 100vw;[\s\S]*?height: 100dvh;/);
    expect(css).toContain('min-height: 44px;');
  });

  it('exposes frequent Access edit while retaining role-aware backend-driven actions', () => {
    expect(access).toContain('data-row-primary-action');
    expect(access).toContain('onEdit(account, event.currentTarget)');
    expect(access).toContain('visibleAccountActions(role, account, originalUserId)');
    expect(access).toContain('const actions = visibleAccountActions');
  });

  it('prioritizes action-required work before passive dashboard analysis', () => {
    expect(dashboard).toContain('dashboard-focus-band');
    expect(dashboard).toContain('งานที่ต้องจัดการ');
    expect(dashboard.indexOf('<AttentionNeededCard')).toBeLessThan(dashboard.indexOf('<TodayOperationsCard'));
    expect(dashboard.indexOf('dashboard-focus-band')).toBeLessThan(dashboard.indexOf('dashboard-secondary-grid'));
  });

  it('turns pending leave approval into one persistent decision workspace without weakening self-approval rules', () => {
    expect(main).toContain('leave-decision-workspace');
    expect(main).toContain('leave-decision-queue');
    expect(main).toContain('leave-decision-detail');
    expect(main).toContain('leave-decision-actions');
    expect(main).toContain("String(selectedPending.employeeId || '') === String(employeeId || '')");
    expect(main).toContain('onApprove(selectedPending)');
    expect(main).toContain('onReject(selectedPending)');
  });

  it('keeps top Theme authoritative and does not add business-data calls to theme switching', () => {
    expect(main).not.toContain('<div className="sidebar-theme-block">');
    expect(main).toContain('<ThemeControl compact />');
    expect(theme).toContain("value: 'system'");
    expect(theme).toContain("value: 'light'");
    expect(theme).toContain("value: 'dark'");
    expect(theme).not.toContain('api.');
    expect(theme).not.toMatch(/location\.(reload|assign|replace)/);
  });

  it('uses layout-shaped loading and mobile record cards instead of shrinking dense desktop tables', () => {
    expect(main).toContain('signature-table-skeleton');
    expect(main).toContain('signature-mobile-records');
    expect(main).toContain('signature-mobile-record');
    expect(css).toContain('.signature-data-surface .data-table-scroll { display: none; }');
    expect(css).toContain('.signature-mobile-records { display: grid;');
    expect(css).toContain('@media (max-width: 390px)');
  });

  it('limits eager reference data fetching to routes that actually need the data', () => {
    expect(main).toContain("!['employees', 'licenses', 'schedule', 'leave', 'leavePending', 'leaveHistory', 'quota'].includes(activePage)");
    expect(main).toContain("!['schedule', 'shiftSetup'].includes(activePage)");
  });
});


describe('SMS Signature Experience V1.1 final polish contracts', () => {
  const polishCss = read('styles/signature-experience-v1-1.css');
  const personnelDrawer = read('components/personnel/PersonnelDetailDrawer.tsx');

  it('bundles modern Thai and Latin typography and loads V1.1 last', () => {
    for (const fontImport of [
      "@fontsource/noto-sans-thai/thai-400.css",
      "@fontsource/noto-sans-thai/thai-500.css",
      "@fontsource/noto-sans-thai/thai-600.css",
      "@fontsource/noto-sans-thai/thai-700.css",
      "@fontsource/inter/latin-400.css",
      "@fontsource/inter/latin-500.css",
      "@fontsource/inter/latin-600.css",
      "@fontsource/inter/latin-700.css",
    ]) expect(main).toContain(fontImport);
    expect(polishCss).toContain('--font-ui: "Noto Sans Thai", "Inter"');
    expect(polishCss).toContain('--font-heading: "Inter", "Noto Sans Thai"');
    expect(polishCss).toContain('--font-mono: "IBM Plex Mono"');
    expect(main.indexOf("import './styles/signature-experience-v1-1.css';")).toBeGreaterThan(main.indexOf("import './styles/signature-experience.css';"));
    expect(polishCss).not.toContain('Leelawadee UI');
  });

  it('locks readable dark Schedule identity and metadata semantics', () => {
    for (const token of ['--text-primary', '--text-secondary', '--text-muted', '--text-disabled', '--text-brand', '--text-danger', '--text-success', '--text-warning']) expect(polishCss).toContain(token);
    expect(polishCss).toContain('[data-theme="dark"] .schedule-grid .employee-sticky');
    expect(polishCss).toContain('background: var(--table-row-bg) !important;');
    expect(polishCss).toContain('[data-theme="dark"] .schedule-grid .employee-sticky strong');
    expect(polishCss).toContain('[data-theme="dark"] .schedule-grid .employee-sticky small');
    expect(polishCss).toContain('color: var(--table-text-primary) !important;');
    expect(polishCss).toContain('color: var(--table-text-secondary) !important;');
  });

  it('prevents light Schedule controls and month picker islands in dark mode', () => {
    expect(polishCss).toContain('[data-theme="dark"] .schedule-workbench select');
    expect(polishCss).toContain('[data-theme="dark"] .month-grid-trigger');
    expect(polishCss).toContain('[data-theme="dark"] .month-grid-panel');
    expect(polishCss).toContain('background: var(--signature-surface-soft) !important;');
    expect(polishCss).toContain('color-scheme: dark;');
  });

  it('keeps Audit KPI and overflow controls on dark semantic surfaces', () => {
    expect(polishCss).toContain('[data-theme="dark"] .audit-metric');
    expect(polishCss).toContain('background: var(--signature-surface-raised) !important;');
    expect(polishCss).toContain('[data-theme="dark"] .data-row-more-trigger');
    expect(polishCss).toContain('background: transparent !important;');
    expect(polishCss).toContain('border: 1px solid var(--signature-border) !important;');
  });

  it('caps Mobile Personnel search layout instead of stretching the toolbar', () => {
    expect(polishCss).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.personnel-search-panel[\s\S]*?height: auto !important;/);
    expect(polishCss).toMatch(/\.personnel-search-input\.data-search-control[\s\S]*?height: 46px !important;[\s\S]*?min-height: 46px !important;/);
    expect(polishCss).toMatch(/\.personnel-search-row\.data-toolbar > select[\s\S]*?height: 44px !important;/);
  });

  it('compacts Mobile Dashboard and preserves complete SMS brand geometry', () => {
    expect(polishCss).toContain('.dashboard-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)) !important;');
    expect(polishCss).toContain('min-height: 66px !important;');
    expect(polishCss).toContain('.dashboard-secondary-metrics { display: none !important; }');
    expect(polishCss).toContain('.mobile-brand .brand-mark');
    expect(polishCss).toContain('overflow: visible !important;');
    expect(polishCss).toContain('text-overflow: clip !important;');
  });

  it('normalizes key user-facing language without weakening the accepted interaction architecture', () => {
    expect(main).toContain('<h1>ตารางกะรายเดือน</h1>');
    expect(main).not.toContain('<h1>Schedule Calendar</h1>');
    expect(main).toContain('อนุมัติแล้ว');
    expect(main).toContain('รออนุมัติ');
    expect(main).not.toContain('Pending Approval');
    expect(personnelDrawer).toContain('ข้อมูลพนักงาน');
    expect(main).toContain('className="signature-data-row"');
    expect(main).toContain('<OperationalRecordDrawer');
  });

  it('does not reintroduce lower Sidebar Theme or visible V3 branding', () => {
    expect(main).not.toContain('<div className="sidebar-theme-block">');
    expect(main).toContain('<ThemeControl compact />');
    expect(main).toContain('<span className="brand-mark" aria-label="SMS"><b>SMS</b></span>');
    expect(main).not.toMatch(/<[^>]*>\s*SMS V3\s*</i);
  });
});
