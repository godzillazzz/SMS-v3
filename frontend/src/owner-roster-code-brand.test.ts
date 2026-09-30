import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sortScheduleEmployeesByCode } from './schedule-employee-code-order';

const root = path.resolve(__dirname);
const main = fs.readFileSync(path.join(root, 'main.tsx'), 'utf8');
const landing = fs.readFileSync(path.join(root, 'components/AwardPublicExperience.tsx'), 'utf8');
const icon = fs.readFileSync(path.join(root, '../public/attendance-sms-logo.svg'), 'utf8');
const qr = fs.readFileSync(path.join(root, 'components/security-site-qr.ts'), 'utf8');
const visual = fs.readFileSync(path.join(root, 'styles/visual-fidelity.css'), 'utf8');
const nexus = fs.readFileSync(path.join(root, 'styles/command-nexus.css'), 'utf8');
const operational = fs.readFileSync(path.join(root, 'styles/operational-layer.css'), 'utf8');

describe('Owner-approved roster and brand contracts', () => {
  it('orders employees by their codes numerically, without mutating source rows', () => {
    const rows = [
      { id: '10', employeeCode: 'ST-10' },
      { id: '2', employeeCode: 'ST-2' },
      { id: '01', employeeCode: 'ST-01' },
      { id: '1', employeeCode: 'ST-1' }
    ];
    expect(sortScheduleEmployeesByCode(rows).map((row) => row.employeeCode))
      .toEqual(['ST-01', 'ST-1', 'ST-2', 'ST-10']);
    expect(rows[0].employeeCode).toBe('ST-10');
    expect(sortScheduleEmployeesByCode([{ id: 'b', employeeCode: 'B-11' }, { id: 'a', employeeCode: 'A-99' }]).map((row) => row.id))
      .toEqual(['a', 'b']);
  });

  it('sorts both live monthly roster and printed schedule, without user reordering controls', () => {
    expect(main.match(/sortScheduleEmployeesByCode\(rawCalendarEmployees\)/g)).toHaveLength(2);
    expect(main).not.toMatch(/getScheduleRosterOrder|updateScheduleRosterOrder|ScheduleRosterOrderModal|canReorderRoster|rosterOrderDepartment|จัดลำดับพนักงาน/);
    expect(main).toContain('className="schedule-grid"');
  });

  it('keeps the Security Management System subtitle visible in the authenticated sidebar and public tablet navbar', () => {
    expect(main).toContain('<div className="sms-brand-copy"><strong>SMS</strong><span>Security Management System</span></div>');
    expect(operational).not.toContain('.sidebar-brand>div span{display:none!important}');
    expect(operational).toContain('.app-shell:not(.pwa-shell) .sidebar-brand>.sms-brand-copy>span{display:block!important}');
    expect(operational).toMatch(/\.sidebar-brand \.sms-brand-copy>span\{[^}]*display:block!important;[^}]*font-family:"Plus Jakarta Sans","Kanit",sans-serif!important;/);
    expect(nexus).not.toContain('.nexus-brand__copy small{display:none}');
    expect(nexus).toMatch(/@media\(max-width:760px\)[\s\S]*?\.nexus-brand__copy small\{display:block\}/);
    expect(nexus).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.award-auth-page \.nexus-brand__copy small\s*\{\s*display: block !important;/);
  });

  it('uses the reference shield and versionless SMS identity across brand surfaces', () => {
    expect(icon).toContain('sms-shield-gradient');
    expect(icon).toContain('sms-y-gradient');
    expect(icon).toContain('<circle cx="50" cy="60" r="22"');
    expect(icon).toContain('M37 51 L50 63 L63 51 M50 63 V77');
    expect(icon).not.toContain('fill="#123b8f"');
    expect(visual).toMatch(/\.nexus-brand__mark \.brand-logo\s*\{[^}]*filter:\s*none;/);
    expect(visual).toMatch(/\[data-theme="dark"\] \.brand-logo\s*\{[^}]*filter:\s*none;/);
    expect(nexus).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.nexus-brand__copy small\s*\{[^}]*display: block !important;/);
    expect(main).toContain('src="/attendance-sms-logo.svg"');
    expect(main).toContain('Security Management System</strong>');
    expect(main).toContain('Security Management System</small>');
    expect(landing).toContain('<strong>SMS</strong><small>Security Management System</small>');
    expect(qr).not.toContain('Security Management System V3');
    expect(main).not.toMatch(/<[^>]+>\s*SMS V3\s*</i);
  });
});