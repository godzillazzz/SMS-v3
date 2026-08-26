import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.tsx');
const table = read('components/personnel/PersonnelTable.tsx');
const drawer = read('components/personnel/PersonnelDetailDrawer.tsx');
const directory = read('pages/personnel/PersonnelDirectoryPage.tsx');

describe('Employee action and bulk auto-schedule hotfix', () => {
  it('keeps a single Employee Master edit entry point for lifecycle changes', () => {
    expect(table).toContain('แก้ไขข้อมูล');
    expect(drawer).toContain('แก้ไขข้อมูล');
    expect(table).not.toContain('จัดการสถานะพนักงาน');
    expect(drawer).not.toContain('จัดการสถานะพนักงาน');
    expect(table).not.toContain('onLifecycle');
    expect(drawer).not.toContain('onLifecycle');
    expect(directory).not.toContain('onLifecycle');
    expect(main).not.toContain('EmployeeLifecycleModal');
  });

  it('removes the obsolete Schedule Archive action', () => {
    expect(main).not.toContain('ย้ายตารางกะเก่าไป Schedule Archive');
    expect(main).not.toContain('ตารางกะเดิมถูกเก็บในระบบแยกส่วนย้อนหลังแล้ว');
  });

  it('describes bulk auto scheduling as all-employee magic-wand continuation from the previous month', () => {
    expect(main).toContain('✨ ดูตัวอย่างจัดกะอัตโนมัติ');
    expect(main).toContain('api.previewAutoSchedule(auth.token, scheduleMonth)');
    expect(main).toContain('Shared Pattern Engine เดียวกับไม้กายสิทธิ์รายบุคคล');
    expect(main).toContain('Auto Continue แบบเดียวกับไม้กายสิทธิ์รายบุคคล');
    expect(main).toContain('พนักงานทั่วไป 6D / OFF / 6N / OFF');
    expect(main).toContain('คง AL และ Admin license override');
  });
});