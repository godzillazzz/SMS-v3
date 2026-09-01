import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const read=(p:string)=>fs.readFileSync(path.join(__dirname,p),'utf8');
const editor=read('components/personnel/EmployeeGovernedEditModal.tsx');
const css=read('styles/employee-governed-edit.css');

describe('EMP-UX governed Edit impact preview and conflict visibility',()=>{
  it('keeps one governed Edit while making active and future-effective change state prominent for every role',()=>{
    expect(editor).toContain('สถานะการเปลี่ยนแปลงที่ต้องเห็นก่อนแก้ไข');
    expect(editor).toContain('activeRequest || futureApprovedRequest');
    expect(editor).toContain('อนุมัติแล้ว · รอวันที่มีผล');
    expect(editor).toContain('backend ยังคงเป็นผู้ตัดสิน conflict/concurrency');
  });
  it('groups authoritative preflight output into no impact review and follow-up presentation',()=>{
    expect(editor).toContain('Impact Preview ก่อนบันทึก');
    expect(editor).toContain('ไม่กระทบ');
    expect(editor).toContain('ต้องตรวจสอบ');
    expect(editor).toContain('ต้องติดตาม');
    expect(editor).toContain('preflight.warnings.map');
    expect(editor).toContain('Object.entries(impactSnapshot)');
  });
  it('does not move warning acknowledgement or save authority into client grouping',()=>{
    expect(editor).toContain('preflight.warnings.length > 0 && <label className="employee-warning-confirm"');
    expect(editor).toContain('disabled={busy || !preflight || (preflight.warnings.length > 0 && !acknowledgeWarnings)}');
    expect(editor).toContain('ไม่ได้สร้างกฎอนุมัติใหม่บน client');
  });
  it('uses responsive semantic presentation for grouped impact',()=>{
    expect(css).toContain('.employee-impact-groups');
    expect(css).toContain('var(--color-success)');
    expect(css).toContain('var(--color-warning)');
    expect(css).toContain('var(--color-info)');
    expect(css).toContain('@media(max-width:760px){.employee-impact-groups{grid-template-columns:1fr}}');
  });
});
