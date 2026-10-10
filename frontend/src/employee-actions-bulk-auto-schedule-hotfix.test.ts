import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.tsx');
const table = read('components/personnel/PersonnelTable.tsx');
const drawer = read('components/personnel/PersonnelDetailDrawer.tsx');
const directory = read('pages/personnel/PersonnelDirectoryPage.tsx');

describe('Employee action and bulk auto-schedule hotfix', () => {
  it('uses one governed Edit button as the only Employee management entry point', () => {
    expect(table).toContain('แก้ไขข้อมูล');
    expect(drawer).toContain('แก้ไขข้อมูล');
    expect(table).not.toContain('การเปลี่ยนแปลงสำคัญ');
    expect(drawer).not.toContain('การเปลี่ยนแปลงสำคัญ');
    expect(table).not.toContain('onLifecycle');
    expect(drawer).not.toContain('onLifecycle');
    expect(directory).not.toContain('onLifecycle');
    expect(main).toContain('EmployeeGovernedEditModal');
    expect(main).not.toContain('EmployeeLifecycleModal');
    expect(main).not.toContain('employeeLifecycleTarget');
  });

  it('removes the obsolete Schedule Archive action', () => {
    expect(main).not.toContain('ย้ายตารางกะเก่าไป Schedule Archive');
    expect(main).not.toContain('ตารางกะเดิมถูกเก็บในระบบแยกส่วนย้อนหลังแล้ว');
  });

  it('describes bulk auto scheduling as all-employee magic-wand continuation from the previous month', () => {
    expect(main).toContain('ดูตัวอย่างจัดกะอัตโนมัติ');
    expect(main).toContain('api.previewAutoSchedule(auth.token, scheduleMonth)');
    expect(main).not.toContain('Shared Pattern Engine');
    expect(main).not.toContain('ตรวจสอบ workflow, validation และ backend behavior');
    expect(main).not.toContain('Auto Continue แบบเดียวกับไม้กายสิทธิ์รายบุคคล');
    expect(main).not.toContain('ใช้ Pattern Master เดียวกับไม้กายสิทธิ์รายบุคคล');
    expect(main).not.toContain('อ่านแพทเทิร์น Supervisor/พนักงานทั่วไปจากค่าที่ Admin จัดการ');
    expect(main).not.toContain('คง AL และ Admin license override');
    expect(main).not.toContain('Google Sheets ถูกยกเลิก');
  });

  it('keeps bulk auto-schedule preview fill-only while retaining the individual replace path', () => {
    expect(main).toContain('addAutoSchedulePreviewDrafts(scheduleDrafts, previewRowsParam');
    expect(main).toContain('applyPreviewToDrafts(rows, employeeId)');
    expect(main).toContain('จะเติม {previewFillSummary.generated} ช่องว่าง · คงกะเดิมไว้ {previewFillSummary.preservedExisting} ช่อง');
    expect(main).toContain('ทุกช่องจัดไว้แล้ว ไม่มีอะไรให้เติม');
    expect(main).toContain("'คงฉบับร่าง' : preserved ? 'คงกะเดิม' : 'เติมอัตโนมัติ'");
  });
});
