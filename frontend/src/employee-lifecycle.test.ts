import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const modal = read('components/personnel/EmployeeLifecycleModal.tsx');
const directory = read('pages/personnel/PersonnelDirectoryPage.tsx');
const table = read('components/personnel/PersonnelTable.tsx');
const api = read('api.ts');
const app = read('main.tsx');
const styles = read('styles/employee-lifecycle.css');

describe('Employee Lifecycle Management V1', () => {
  it('supports all five ADMIN-controlled lifecycle actions in Thai', () => {
    for (const type of ['NAME_CHANGE', 'DEPARTMENT_TRANSFER', 'POSITION_CHANGE', 'EMPLOYMENT_TERMINATION', 'REHIRE']) expect(modal).toContain(type);
    for (const label of ['เปลี่ยนชื่อ', 'ย้ายแผนก', 'เปลี่ยนตำแหน่ง', 'ลาออก', 'กลับเข้าทำงาน', 'วันที่มีผล', 'เหตุผล', 'ผลกระทบและคำเตือน']) expect(modal).toContain(label);
    expect(table).toContain("role === 'ADMIN'");
    expect(directory).toContain('onLifecycle');
    expect(app).toContain("auth.user?.role === 'ADMIN'");
  });

  it('uses preflight, idempotency, explicit warning acknowledgement, and deliberate termination confirmation', () => {
    expect(modal).toContain('api.preflightEmployeeLifecycle');
    expect(modal).toContain('api.createEmployeeLifecycleEvent');
    expect(modal).toContain('crypto.randomUUID()');
    expect(modal).toContain('acknowledgeWarnings: true');
    expect(modal).toContain('expectedLifecycleSequence: preflight.latestLifecycleSequence');
    expect(modal).toContain('ApiRequestError');
    expect(modal).toContain('รหัสอ้างอิง:');
    expect(modal).toContain("confirmation !== employee.employeeCode");
    expect(modal).toContain('disabled={busy');
  });

  it('renders immutable history with actor, effective date, recorded time, and old/new state', () => {
    expect(modal).toContain('ประวัติวงจรพนักงาน');
    expect(modal).toContain('อ่านอย่างเดียว');
    expect(modal).toContain('eventChange(event)');
    expect(modal).toContain('event.changedBy?.displayName');
    expect(modal).toContain('event.createdAt');
    expect(modal).not.toMatch(/api\.(?:update|delete)EmployeeLifecycle/);
  });

  it('keeps controlled fields out of ordinary Employee editing', () => {
    const profileSegment = app.slice(app.indexOf('const employeeProfileFields'), app.indexOf('const openEmployeeEditor'));
    expect(profileSegment).not.toContain("name: 'firstName'");
    expect(profileSegment).not.toContain("name: 'lastName'");
    expect(profileSegment).not.toContain("name: 'department'");
    expect(profileSegment).not.toContain("name: 'jobTitle'");
    expect(app).not.toContain('api.deleteEmployee(auth.token, employee.id)');
  });

  it('exposes cohesive lifecycle API methods and responsive modal styles', () => {
    for (const route of ['/lifecycle?', '/lifecycle/state?date=', '/lifecycle/preflight', '/lifecycle`']) expect(api).toContain(route);
    expect(styles).toContain('@media(max-width:850px)');
    expect(styles).toContain('@media(max-width:520px)');
    expect(styles).toContain('max-height:100dvh');
    expect(styles).toContain('white-space:nowrap');
  });
});
