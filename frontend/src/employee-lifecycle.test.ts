import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const modal = read('components/personnel/EmployeeLifecycleModal.tsx');
const directory = read('pages/personnel/PersonnelDirectoryPage.tsx');
const table = read('components/personnel/PersonnelTable.tsx');
const drawer = read('components/personnel/PersonnelDetailDrawer.tsx');
const api = read('api.ts');
const app = read('main.tsx');
const styles = read('styles/employee-lifecycle.css');

describe('Employee Critical Changes + Lifecycle', () => {
  it('restores an ADMIN-only critical-change entry point while preserving normal governed edit', () => {
    expect(table).toContain('การเปลี่ยนแปลงสำคัญ');
    expect(drawer).toContain('การเปลี่ยนแปลงสำคัญ');
    expect(table).toContain('canLifecycle && onLifecycle');
    expect(directory).toContain("const canLifecycle = role === 'ADMIN' && Boolean(onLifecycle);");
    expect(directory).toContain('onLifecycle={onLifecycle}');
    expect(app).toContain("import { EmployeeLifecycleModal }");
    expect(app).toContain("employeeLifecycleTarget && auth.token && auth.user?.role === 'ADMIN' && !auth.isViewingAs");
    expect(app).toContain('EmployeeGovernedEditModal');
  });

  it('supports the five lifecycle actions with clear Thai wording', () => {
    for (const type of ['NAME_CHANGE', 'DEPARTMENT_TRANSFER', 'POSITION_CHANGE', 'EMPLOYMENT_TERMINATION', 'REHIRE']) expect(modal).toContain(type);
    for (const label of ['เปลี่ยนชื่อ', 'ย้ายหน่วยงาน', 'เปลี่ยนตำแหน่ง', 'ลาออก', 'กลับเข้าทำงาน', 'วันที่มีผล', 'เหตุผล', 'ผลกระทบและคำเตือน']) expect(modal).toContain(label);
    expect(modal).toContain("api.preflightEmployeeLifecycle(token, employee.id");
    expect(modal).toContain('api.createEmployeeLifecycleEvent(token, employee.id');
  });

  it('adds four important Employee Master changes without a schema enum expansion', () => {
    for (const type of ['EMPLOYEE_CODE_CHANGE', 'CONTACT_CHANGE', 'HIRE_DATE_CORRECTION', 'SKILL_QUALIFICATION_CHANGE']) expect(modal).toContain(type);
    for (const label of ['เปลี่ยนรหัสพนักงาน', 'เปลี่ยนข้อมูลติดต่อ', 'แก้ไขวันที่เริ่มงาน', 'ปรับทักษะ / คุณสมบัติ']) expect(modal).toContain(label);
    expect(modal).toContain("api.preflightEmployeeMasterEdit(token, employee.id");
    expect(modal).toContain('api.updateEmployee(token, employee.id');
    expect(modal).toContain("effectiveMode: 'IMMEDIATE'");
    expect(modal).toContain('ข้อมูลประเภทนี้เป็น immediate-only');
    expect(modal).not.toContain("type CriticalMasterType = 'MASTER_EDIT'");
  });

  it('keeps preflight, idempotency, explicit warning acknowledgement, and termination confirmation', () => {
    expect(modal).toContain('crypto.randomUUID()');
    expect(modal).toContain('expectedLifecycleSequence: preflight.latestLifecycleSequence');
    expect(modal).toContain('checked={acknowledgeWarnings}');
    expect(modal).toContain('setAcknowledgeWarnings(event.target.checked)');
    expect(modal).toContain('acknowledgeWarnings');
    expect(modal).not.toContain('acknowledgeWarnings: true');
    expect(modal).toContain("confirmation !== employee.employeeCode");
    expect(modal).toContain('toRequestErrorState');
    expect(modal).toContain('<RequestErrorContent error={error} />');
  });

  it('renders immutable history including MASTER_EDIT with useful before-to-after summaries', () => {
    expect(modal).toContain("type StoredLifecycleType = LifecycleType | 'MASTER_EDIT'");
    expect(modal).toContain('ประวัติการเปลี่ยนแปลงสำคัญ');
    expect(modal).toContain('อ่านอย่างเดียว');
    expect(modal).toContain('historyTypeLabel(event)');
    expect(modal).toContain('masterChangedFields(event)');
    expect(modal).toContain('eventChange(event)');
    expect(modal).toContain('event.changedBy?.displayName');
    expect(modal).toContain('event.createdAt');
    expect(modal).not.toMatch(/api\.(?:update|delete)EmployeeLifecycle/);
  });

  it('keeps Face Reference Photo, License and User Access out of the critical-change mutation path', () => {
    expect(modal).toContain('รูปอ้างอิงใบหน้า ใบอนุญาต และสิทธิ์ระบบยังคงจัดการผ่าน workflow เฉพาะของแต่ละโมดูล');
    expect(modal).not.toContain('uploadEmployeeReferencePhoto');
    expect(modal).not.toContain('updateLicense');
    expect(modal).not.toContain('updateUser(');
  });

  it('keeps cohesive lifecycle APIs and responsive modal styles', () => {
    for (const route of ['/lifecycle?', '/lifecycle/state?date=', '/lifecycle/preflight']) expect(api).toContain(route);
    expect(api).toContain('createEmployeeLifecycleEvent');
    expect(styles).toContain('.lifecycle-warning-confirm');
    expect(styles).toContain('.lifecycle-effective-note');
    expect(styles).toContain('@media(max-width:850px)');
    expect(styles).toContain('@media(max-width:520px)');
    expect(styles).toContain('max-height:100dvh');
    expect(styles).toContain('white-space:nowrap');
  });
});
