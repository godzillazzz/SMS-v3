import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const editor = read('components/personnel/EmployeeGovernedEditModal.tsx');
const directory = read('pages/personnel/PersonnelDirectoryPage.tsx');
const table = read('components/personnel/PersonnelTable.tsx');
const drawer = read('components/personnel/PersonnelDetailDrawer.tsx');
const app = read('main.tsx');
const styles = read('styles/employee-governed-edit.css');

describe('Employee single-entry governed changes', () => {
  it('exposes only the Edit button and removes the duplicate lifecycle entry point', () => {
    expect(table).toContain('แก้ไขข้อมูล');
    expect(drawer).toContain('แก้ไขข้อมูล');
    expect(table).not.toContain('onLifecycle');
    expect(drawer).not.toContain('onLifecycle');
    expect(directory).not.toContain('onLifecycle');
    expect(app).not.toContain("import { EmployeeLifecycleModal }");
    expect(app).not.toContain('employeeLifecycleTarget');
    expect(app).toContain('EmployeeGovernedEditModal');
  });

  it('keeps all important Employee Master fields in the same governed editor', () => {
    for (const label of ['รหัสพนักงาน', 'ชื่อ', 'นามสกุล', 'อีเมลติดต่อ', 'โทรศัพท์', 'หน่วยงาน', 'ตำแหน่ง', 'วันที่เริ่มงาน', 'ทักษะ / คุณสมบัติ']) {
      expect(editor).toContain(label);
    }
    expect(editor).toContain('3. การเปลี่ยนแปลง');
    expect(editor).toContain('จัดการการเปลี่ยนแปลงสำคัญของพนักงานจากหน้าต่าง “แก้ไขข้อมูล” นี้');
    expect(editor).not.toContain('3. สถานะพนักงาน / วงจรพนักงาน');
  });

  it('keeps termination and return-to-work choices with effective-date governance', () => {
    for (const label of ['ปฏิบัติงาน', 'ลาออก', 'กลับเข้าทำงาน', 'รูปแบบวันที่มีผล', 'มีผลทันที', 'กำหนดวันที่มีผล', 'เหตุผล / หมายเหตุ']) {
      expect(editor).toContain(label);
    }
    expect(editor).toContain("['ACTIVE', 'RETURN_TO_WORK'].includes(event.target.value)");
    expect(editor).toContain("effectiveMode === 'FUTURE_EFFECTIVE'");
    expect(editor).toContain('การลาออกหรือกลับเข้าทำงานต้องระบุเหตุผลเพื่อบันทึก Audit');
  });

  it('keeps Admin preflight, impact acknowledgement, optimistic concurrency, and audited mutation', () => {
    expect(editor).toContain('api.preflightEmployeeMasterEdit(token, employee.id');
    expect(editor).toContain('api.updateEmployee(token, employee.id');
    expect(editor).toContain('expectedEmployeeUpdatedAt: preflight.expectedEmployeeUpdatedAt');
    expect(editor).toContain('expectedLifecycleSequence: preflight.latestLifecycleSequence');
    expect(editor).toContain('checked={acknowledgeWarnings}');
    expect(editor).toContain('acknowledgeWarnings');
    expect(editor).toContain('ผลกระทบก่อนบันทึก');
    expect(editor).toContain('คำขอ / ประวัติการเปลี่ยนแปลง');
  });

  it('keeps Manager edits behind the existing Admin approval request workflow', () => {
    expect(editor).toContain('api.createEmployeeChangeDraft');
    expect(editor).toContain('api.saveEmployeeChangeDraft');
    expect(editor).toContain('api.submitEmployeeChangeRequest');
    expect(editor).toContain('api.resubmitEmployeeChangeRequest');
    expect(editor).toContain('ส่งคำขอแก้ไขให้ Admin ตรวจสอบแล้ว');
    expect(editor).toContain("const isAdmin = role === 'ADMIN'");
  });

  it('keeps the reference-photo governed panel inside Edit without merging unrelated License/User Access workflows', () => {
    expect(editor).toContain('<EmployeeReferencePhotoPanel');
    expect(editor).not.toContain('updateLicense');
    expect(editor).not.toContain('updateUser(');
  });

  it('keeps the governed modal responsive and accessible', () => {
    expect(editor).toContain('role="dialog" aria-modal="true"');
    expect(editor).toContain('acquireDocumentScrollLock');
    expect(styles).toContain('@media(max-width:760px)');
    expect(styles).toContain('.employee-governed-section-note');
  });
});
