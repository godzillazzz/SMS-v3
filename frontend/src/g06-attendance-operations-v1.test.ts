import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const wrapper = read('./components/SecuritySiteManagementPanel.tsx');
const operations = read('./pages/attendance/AttendanceOperationsPanel.tsx');
const client = read('./pages/attendance/attendance-operations-client.ts');
const css = read('./pages/attendance/attendance.css');
const operationsCss = read('./pages/attendance/attendance-operations.css');

describe('G06 Attendance supervisor and monthly governance UX', () => {
  it('mounts governed operations on the Attendance surface while preserving Security Site core management', () => {
    expect(wrapper).toContain('AttendanceOperationsPanel');
    expect(wrapper).toContain('SecuritySiteManagementCorePanel');
    expect(wrapper).toContain('impersonatorSub');
    expect(wrapper).toContain('readOnly: Boolean(parsed.impersonatorSub)');
  });

  it('exposes server-authoritative supervisor filters and governed corrections', () => {
    expect(client).toContain('/attendance/supervisor/daily');
    expect(client).toContain('/attendance/governance/assignments/');
    expect(operations).toContain('บันทึกพร้อม Audit');
    expect(operations).toContain('originalCheckInAt');
    expect(operations).toContain('originalCheckOutAt');
    expect(operations).toContain('WRONG_SHIFT');
  });

  it('blocks certification in UI while server blockers remain and supports unlock revision workflow', () => {
    expect(operations).toContain('preview.blockerCount > 0');
    expect(operations).toContain('รับรองและล็อกเดือน');
    expect(operations).toContain('ปลดล็อกเพื่อแก้ไข');
    expect(client).toContain('/certify');
    expect(client).toContain('/unlock');
  });

  it('provides certified XLSX plus printable PDF from the same official report model without face images', () => {
    expect(client).toContain('/report.xlsx');
    expect(client).toContain('/report`');
    expect(operations).toContain("printDocument('.attendance-official-print'");
    expect(operations).toContain('No biometric images included');
    expect(operations).not.toContain('photo');
    expect(operations).not.toContain('verificationSnapshot');
    expect(css).toContain("@import './attendance-operations.css'");
    expect(operationsCss).toContain('.attendance-official-print');
  });
});
