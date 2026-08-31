import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const editor = fs.readFileSync(path.join(root, 'components/personnel/EmployeeGovernedEditModal.tsx'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles/employee-governed-edit.css'), 'utf8');

describe('Employee critical change actions V2', () => {
  it('keeps Employee management under the single governed Edit experience', () => {
    expect(editor).toContain('1. ข้อมูลทั่วไป');
    expect(editor).toContain('2. ข้อมูลการปฏิบัติงาน');
    expect(editor).toContain('3. การเปลี่ยนแปลง');
    expect(editor).toContain('5. คำขอ / ประวัติการเปลี่ยนแปลง');
    expect(editor).not.toContain('สถานะพนักงาน / วงจรพนักงาน');
    expect(main).toContain('<EmployeeGovernedEditModal');
    expect(main).not.toContain('<EmployeeLifecycleModal');
  });

  it('renders the agreed critical actions visibly inside section 3', () => {
    for (const marker of [
      "NAME_CHANGE",
      "DEPARTMENT_TRANSFER",
      "POSITION_CHANGE",
      "EMPLOYMENT_TERMINATION",
      "REHIRE",
      "เปลี่ยนชื่อ",
      "ย้ายหน่วยงาน",
      "เปลี่ยนตำแหน่ง",
      "ลาออก",
      "กลับเข้าทำงาน"
    ]) expect(editor).toContain(marker);
    expect(editor).toContain('employee-change-action-grid');
    expect(editor).toContain('aria-label="ประเภทการเปลี่ยนแปลงพนักงาน"');
  });

  it('removes duplicate direct editing paths for lifecycle-controlled identity and assignment fields', () => {
    expect(editor).toContain('ชื่อปัจจุบัน');
    expect(editor).toContain('นามสกุลปัจจุบัน');
    expect(editor).toContain('หน่วยงานปัจจุบัน');
    expect(editor).toContain('ตำแหน่งปัจจุบัน');
    expect(editor).toContain('readOnly aria-readonly="true"');
    expect(editor).toContain('ใช้ “เปลี่ยนชื่อ” ในหัวข้อ 3. การเปลี่ยนแปลง');
    expect(editor).toContain('ใช้ “ย้ายหน่วยงาน” ในหัวข้อ 3');
    expect(editor).toContain('ใช้ “เปลี่ยนตำแหน่ง” ในหัวข้อ 3');
  });

  it('name transfer and position actions show current-to-new context while preserving one Employee identity', () => {
    expect(editor).toContain('ชื่อใหม่');
    expect(editor).toContain('นามสกุลใหม่');
    expect(editor).toContain('หน่วยงานใหม่');
    expect(editor).toContain('ตำแหน่งใหม่');
    expect(editor).toContain('ปัจจุบัน');
    expect(editor).toContain('หน่วยงานเดิม');
    expect(editor).toContain('ตำแหน่งเดิม');
    expect(editor).toContain('ระบบจะคง Employee ID เดิม');
    expect(editor).toContain('api.preflightEmployeeMasterEdit');
    expect(editor).toContain('api.updateEmployee');
    expect(editor).not.toContain('createEmployee(');
  });

  it('department transfer calls out dependent schedule leave site authority and linked account impact review', () => {
    expect(editor).toContain('เวรในอนาคต');
    expect(editor).toContain('ใบลา');
    expect(editor).toContain('Site/Department authority');
    expect(editor).toContain('บัญชีผู้ใช้ที่เชื่อมโยง');
    expect(editor).toContain('preflight.impacts.futureShiftAssignments');
    expect(editor).toContain('preflight.impacts.pendingLeaveRequests');
  });

  it('critical changes require effective timing and an auditable reason', () => {
    expect(editor).toContain('รูปแบบวันที่มีผล');
    expect(editor).toContain('กำหนดวันที่มีผล');
    expect(editor).toContain('วันที่มีผล');
    expect(editor).toContain('const criticalReasonRequired = hasCriticalChanges');
    expect(editor).toContain('required={criticalReasonRequired}');
    expect(editor).toContain('ต้องมีเหตุผลเพื่อบันทึก Audit');
  });

  it('status change uses the same actions instead of a hidden status selector', () => {
    expect(editor).toContain("selectCriticalAction('EMPLOYMENT_TERMINATION')");
    expect(editor).toContain("selectCriticalAction('REHIRE')");
    expect(editor).toContain("{ isActive: false }");
    expect(editor).toContain("{ isActive: true }");
    expect(editor).not.toContain('<option value="RESIGN">');
    expect(editor).not.toContain('<option value="RETURN_TO_WORK">');
  });

  it('switching critical action resets the previous critical draft so one action has one intent', () => {
    expect(editor).toContain('const criticalBase = () =>');
    expect(editor).toContain('if (criticalAction === action) return');
    expect(editor).toContain('...criticalBase()');
    expect(editor).toContain("action === 'EMPLOYMENT_TERMINATION'");
    expect(editor).toContain("action === 'REHIRE'");
  });

  it('revision history identifies critical change categories in readable labels', () => {
    expect(editor).toContain('revisionCriticalLabels');
    expect(editor).toContain('employee-revision-actions');
    for (const label of ['เปลี่ยนชื่อ', 'ย้ายหน่วยงาน', 'เปลี่ยนตำแหน่ง', 'เปลี่ยนสถานะการจ้าง']) expect(editor).toContain(label);
  });

  it('critical action layout remains usable on tablet and phone', () => {
    expect(css).toContain('.employee-change-action-grid');
    expect(css).toContain('.employee-critical-editor');
    expect(css).toContain('@media(max-width:760px)');
    expect(css).toContain('@media(max-width:420px)');
  });
});
