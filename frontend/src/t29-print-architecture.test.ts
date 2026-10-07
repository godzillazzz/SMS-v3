import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const styles = read('styles.css');
const executiveStyles = read('styles/executive-report.css');
const attendanceStyles = read('styles/attendance-report.css');
const helper = read('schedule-print.ts');
const app = read('main.tsx');

describe('T29 isolated print architecture', () => {
  test('global application styles do not declare a page orientation', () => {
    expect(styles).not.toMatch(/@page/i);
    expect(executiveStyles).not.toMatch(/@page/i);
    expect(attendanceStyles).not.toMatch(/@page/i);
  });

  test('all documents are cloned into an isolated iframe with the chosen A4 geometry applied last', () => {
    expect(helper).toContain("document.createElement('iframe')");
    expect(helper).toContain('frameDocument.body.append(printRoot.cloneNode(true))');
    expect(helper).toContain('@page { size: A4 ${orientation}; margin: ${margin}; }');
    expect(helper).toContain('frameDocument.head.append(isolationStyle)');
  });

  test('application-owned print triggers do not invoke the application window print dialog', () => {
    expect(app).not.toContain('window.print()');
    expect(app).not.toContain('printing-leave');
    expect(app).toContain("printDocument('.leave-print-document'");
    expect(app).toContain("printTableReport('.signature-data-table'");
    expect(app).toContain("printTableReport('.audit-table'");
  });

  test('leave types and printed roles use existing user-facing display authorities', () => {
    expect(app).toContain('leaveTypeDisplayText(row)');
    expect(app).toContain('roleDisplayName(auth.user?.role)');
    expect(app).toContain('ผู้ปฏิบัติงานแทน:');
    expect(app).toContain('รายละเอียด:');
  });

  test('roster layout reserves a compact 31 day grid and preserves department grouping', () => {
    expect(helper).toContain('nth-child(n+4):nth-child(-n+34)');
    expect(helper).toContain('font-size: 7pt !important;');
    expect(helper).toContain('.print-table thead { display: table-header-group !important; }');
    expect(helper).toContain('.print-department-group-row + tr');
    expect(app).toContain('sortScheduleEmployeesByDepartment(rawCalendarEmployees)');
  });

  test('attendance report print styles allow document flow and repeat table headers', () => {
    expect(attendanceStyles).toContain('max-height: none;');
    expect(attendanceStyles).toContain('overflow: visible;');
    expect(attendanceStyles).toContain('display: table-header-group;');
    expect(attendanceStyles).toContain('break-inside: avoid;');
  });
});
