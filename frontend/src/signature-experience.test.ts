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
