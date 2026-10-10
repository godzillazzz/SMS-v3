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

  it('keeps the classic flat roster grid while ordering by department and employee code', () => {
    expect(main.match(/sortScheduleEmployeesByDepartment\(rawCalendarEmployees\)/g)).toHaveLength(2);
    expect(main).toContain('className="schedule-grid"');
    expect(main).not.toContain('className="schedule-department-group-row"');
    expect(main).not.toContain('schedule-grid--compact');
    expect(main).not.toContain('calendarDepartmentStartByEmployeeId');
    expect(main).not.toContain('schedule-time-toggle');
    expect(main).not.toMatch(/getScheduleRosterOrder|updateScheduleRosterOrder|ScheduleRosterOrderModal|canReorderRoster|rosterOrderDepartment|จัดลำดับพนักงาน/);
    expect(main).toContain('`แสดง ${calendarEmployees.length} จาก ${allCalendarEmployees.length} คน`');
    expect(main).not.toContain('แสดง {calendarEmployees.length} จาก {operationResponse.meta?.total || 0} คน');
  });

  it('preserves existing printed department headings without inserting rows in the on-screen grid', () => {
    expect(operational).toContain('@media print');
    expect(operational).toContain('.print-table tbody .print-department-group-row > .schedule-department-group-sticky');
    expect(main).toContain('className="schedule-department-group-row print-department-group-row"');
    expect(main).toContain("{dept || 'ไม่ระบุแผนก'} · {deptEmployees.length} คน");
  });

  it('uses the complete horizontal brand image without duplicate HTML subtitles', () => {
    expect(main).toContain('<BrandLogo />');
    expect(main).not.toContain('sms-brand-copy');
    expect(operational).not.toContain('.sms-brand-copy');
    expect(nexus).not.toContain('.nexus-brand__copy');
    expect(landing).toContain('aria-label="SMS Security Management System — กลับภาพรวม"');
  });

  it('uses the reference shield and versionless SMS identity across brand surfaces', () => {
    expect(icon).toContain('sms-shield-gradient');
    expect(icon).toContain('sms-y-gradient');
    expect(icon).toContain('<circle cx="50" cy="60" r="22"');
    expect(icon).toContain('M37 51 L50 63 L63 51 M50 63 V77');
    expect(icon).not.toContain('fill="#123b8f"');
    expect(visual).toMatch(/\.nexus-brand__mark \.brand-logo\s*\{[^}]*filter:\s*none;/);
    expect(visual).toMatch(/\[data-theme="dark"\] \.brand-logo\s*\{[^}]*filter:\s*none;/);
    expect(main).toContain("import { BrandLogo } from './components/BrandLogo';");
    expect(main).not.toContain('src="/attendance-sms-logo.svg"');
    expect(qr).not.toContain('Security Management System V3');
    expect(main).not.toMatch(/<[^>]+>\s*SMS V3\s*</i);
  });
});
