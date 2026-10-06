import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { groupScheduleEmployeesByDepartment, sortScheduleEmployeesByCode, sortScheduleEmployeesByDepartment } from './schedule-employee-code-order';

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

  it('sorts schedule employees by natural department, then code and id, with missing departments last', () => {
    const rows = [
      { id: 'z', department: 'AN10', employeeCode: 'ST-1' },
      { id: 'multi', department: 'AN1,AN2,AN3', employeeCode: 'ST-1' },
      { id: 'c', department: 'AN2', employeeCode: 'ST-10' },
      { id: 'b', department: 'AN2', employeeCode: 'ST-2' },
      { id: 'a', department: 'AN2', employeeCode: 'ST-2' },
      { id: 'none', department: ' ', employeeCode: 'ST-0' }
    ];
    expect(sortScheduleEmployeesByDepartment(rows).map((row) => row.id)).toEqual(['multi', 'a', 'b', 'c', 'z', 'none']);
    expect(groupScheduleEmployeesByDepartment(rows).map((group) => [group.department, group.employees.length]))
      .toEqual([['AN1,AN2,AN3', 1], ['AN2', 3], ['AN10', 1], ['', 1]]);
  });

  it('sorts on-screen and printed schedule by department with grouped on-screen headings', () => {
    expect(main.match(/sortScheduleEmployeesByDepartment\(rawCalendarEmployees\)/g)).toHaveLength(2);
    expect(main).toContain('schedule-department-group-row');
    expect(main).toContain('scope="rowgroup"');
    expect(main).toContain("departmentGroup.employees.length} คน");
    expect(main).not.toMatch(/getScheduleRosterOrder|updateScheduleRosterOrder|ScheduleRosterOrderModal|canReorderRoster|rosterOrderDepartment|จัดลำดับพนักงาน/);
    expect(main).toContain('className="schedule-grid"');
    expect(main).toContain('แสดง {calendarEmployees.length} จาก {allCalendarEmployees.length} คน');
    expect(main).not.toContain('แสดง {calendarEmployees.length} จาก {operationResponse.meta?.total || 0} คน');
  });

  it('styles department group rows distinctly, with a sticky label in light, dark and print layouts', () => {
    expect(operational).toContain('.schedule-grid tbody .schedule-department-group-row');
    expect(operational).toContain('position: sticky;');
    expect(operational).toContain('[data-theme="light"] .app-shell:not(.pwa-shell) .schedule-grid tbody .schedule-department-group-row');
    expect(operational).toContain('[data-theme="dark"] .app-shell .schedule-grid tbody .schedule-department-group-row');
    expect(operational).toContain('@media print');
    expect(operational).toContain('.print-table tbody .print-department-group-row > .schedule-department-group-sticky');
    expect(main).toContain('className="schedule-department-group-row print-department-group-row"');
    expect(main).toContain("{dept || 'ไม่ระบุแผนก'} · {deptEmployees.length} คน");
  });

  it('keeps the Security Management System subtitle visible in the authenticated sidebar and public tablet navbar', () => {
    expect(main).toContain('<div className="sms-brand-copy"><strong>SMS</strong><span>Security Management System</span></div>');
    expect(operational).not.toContain('.sidebar-brand>div span{display:none!important}');
    expect(operational).toContain('.app-shell:not(.pwa-shell) .sidebar-brand>.sms-brand-copy>span{display:block!important}');
    expect(operational).toMatch(/\.sidebar-brand \.sms-brand-copy>span\{[^}]*display:block!important;[^}]*font-family:"Plus Jakarta Sans","Kanit",sans-serif!important;/);
    expect(operational).toContain('.sidebar-brand{min-height:66px!important;margin-bottom:8px!important;padding-bottom:10px!important;gap:4px!important}');
    expect(operational).toContain('letter-spacing:0!important;font-size:10px!important;color:#b4cbd9!important');
    expect(operational).toMatch(/@media\(max-width:1024px\)\s*\{\s*\.app-shell:not\(\.pwa-shell\) \.sidebar-brand>\.sms-brand-copy>span\s*\{\s*white-space:normal!important;\s*line-height:1.3!important;\s*overflow-wrap:break-word!important;/);
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
