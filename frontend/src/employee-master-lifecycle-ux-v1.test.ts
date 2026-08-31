import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const editor = fs.readFileSync(path.join(root, 'components/personnel/EmployeeGovernedEditModal.tsx'), 'utf8');

describe('Employee Master + Lifecycle UX V1', () => {
  it('groups Employee management under the single governed Edit experience', () => {
    expect(editor).toContain('1. ข้อมูลทั่วไป');
    expect(editor).toContain('2. ข้อมูลการปฏิบัติงาน');
    expect(editor).toContain('3. การเปลี่ยนแปลง');
    expect(editor).toContain('คำขอ / ประวัติการเปลี่ยนแปลง');
    expect(editor).not.toContain('สถานะพนักงาน / วงจรพนักงาน');
  });

  it('uses Thai employment-state choices inside the same editor', () => {
    expect(editor).toContain('<option value="ACTIVE">ปฏิบัติงาน</option>');
    expect(editor).toContain('<option value="RESIGN">ลาออก</option>');
    expect(editor).toContain('<option value="RESIGNED">ลาออก</option>');
    expect(editor).toContain('<option value="RETURN_TO_WORK">กลับเข้าทำงาน</option>');
    expect(editor).toContain("['ACTIVE', 'RETURN_TO_WORK'].includes(event.target.value)");
  });

  it('requires an auditable reason when employment status changes', () => {
    expect(editor).toContain('const lifecycleStatusChanged = Boolean(form.isActive) !== Boolean(employee.isActive)');
    expect(editor).toContain('required={lifecycleStatusChanged}');
    expect(editor).toContain('การลาออกหรือกลับเข้าทำงานต้องระบุเหตุผลเพื่อบันทึก Audit');
  });

  it('keeps one Employee identity and uses governed Employee Master mutation', () => {
    expect(editor).toContain('api.preflightEmployeeMasterEdit');
    expect(editor).toContain('api.updateEmployee');
    expect(editor).toContain("update('isActive'");
    expect(editor).not.toContain('createEmployee(');
  });
});
