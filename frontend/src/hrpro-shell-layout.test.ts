import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (name: string) => fs.readFileSync(path.join(__dirname, name), 'utf8').replace(/\r\n/g, '\n');

describe('HR-PRO shell layout (owner decision 2026-10-27)', () => {
  const main = read('main.tsx');
  const shell = read('styles/hrpro-shell.css');
  const userMenu = read('components/UserMenu.tsx');
  const palette = read('components/WorkflowCommandPalette.tsx');

  it('has a remembered sidebar collapse with tooltips on the icon rail', () => {
    expect(main).toContain("localStorage.getItem('sms-v3-sidebar-collapsed') === '1'");
    expect(main).toContain('className="sidebar-collapse-toggle"');
    expect(main).toContain("data-sidebar={sidebarCollapsed ? 'collapsed' : undefined}");
    expect(main).toContain('title={countTitle ?? (sidebarCollapsed ? item.label : undefined)}');
    expect(shell).toContain('--shell-sidebar-w: 252px');
    expect(shell).toContain('[data-sidebar="collapsed"] { --shell-sidebar-w: 72px; }');
  });

  it('keeps the topbar to title, search icon, bell and user menu', () => {
    expect(main).not.toContain('className="topbar-search"');
    expect(main).not.toContain('className="environment-pill"');
    expect(main).toContain('<UserMenu ');
    expect(userMenu).toContain('<ThemeControl compact />');
    expect(userMenu).toContain('<AccentControl');
    expect(userMenu).toContain('hidden={!open}');
    expect(shell).toContain('min-height: 60px !important');
  });

  it('moves employee search into Ctrl+K', () => {
    expect(palette).toContain('onSearchEmployees');
    expect(main).toContain("onSearchEmployees={(query) => { setSearch(query); setActivePage('employees'); }}");
  });

  it('caps content at 1280px except the wide working pages', () => {
    expect(main).toContain("new Set<Page>(['schedule', 'attendanceSupervisor', 'reportCenter', 'reports', 'executiveReport', 'attendanceReport'])");
    expect(shell).toContain('#sms-app:not([data-page-width="wide"]) .content-area { max-width: 1328px !important;');
  });
});
