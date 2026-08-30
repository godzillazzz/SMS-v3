import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('CFG-03 Leave Type Master contract', () => {
  const main = read('main.tsx');
  const client = read('leave-type-client.ts');
  const panel = read('components/LeaveTypeMasterPanel.tsx');
  const api = read('api.ts');

  it('uses a dedicated Leave Type client and leaves central api.ts hash boundary untouched', () => {
    expect(client).toContain('/leave-types');
    expect(client).toContain("method: 'GET'");
    expect(client).toContain("method: 'POST'");
    expect(client).toContain("method: 'PUT'");
    expect(client).not.toContain("method: 'DELETE'");
    expect(api).not.toContain('leaveTypes: (token');
  });

  it('renders Leave Type Master in Configuration Center with immutable codes and no delete control', () => {
    expect(main).toContain('<LeaveTypeMasterPanel');
    expect(panel).toContain('Code เป็น stable identity และแก้ไม่ได้หลังสร้าง');
    expect(panel).toContain('ไม่มีคำสั่ง Delete สำหรับ Leave Type Master');
    expect(panel).toContain('CORE · code/bucket protected');
    expect(panel).toContain('No annual quota');
  });

  it('loads active Leave Types for leave workflow and inactive rows only for Admin settings', () => {
    expect(main).toContain("getLeaveTypes(auth.token, { includeInactive: activePage === 'settings' && auth.user?.role === 'ADMIN' })");
    expect(main).toContain('const activeLeaveTypes = leaveTypes.filter((item) => item.isActive)');
    expect(main).toContain('const leaveTypeOptions = activeLeaveTypes.map');
    expect(main).toContain('leaveTypes={activeLeaveTypes}');
  });

  it('removes hard-coded three-option leave dropdowns and displays historical snapshot names', () => {
    expect(main).toContain('options: leaveTypeOptions');
    expect(main).toContain('options: leaveTypeOptionsForRow(row)');
    expect(main).not.toContain("options: ['ลาป่วย', 'ลากิจ', 'ลาพักร้อน']");
    expect(main).not.toContain("{ value: 'SICK', label: 'ลาป่วย' }, { value: 'PERSONAL', label: 'ลากิจ' }, { value: 'VACATION', label: 'ลาพักร้อน' }");
    expect(main).toContain('text(row.leaveTypeNameSnapshot || row.leaveType)');
  });

  it('uses quota bucket rather than display-name text to trigger sick attachment rules', () => {
    expect(main).toContain("selectedLeaveType?.quotaBucket === 'SICK'");
    expect(main).not.toContain("form.leaveType.includes('ป่วย')");
  });
});
