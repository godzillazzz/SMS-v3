import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('./pages/settings/SettingsPage.tsx', import.meta.url), 'utf8');

describe('T53 user-visible staging copy removal', () => {
  it('uses neutral copy in the shared edit dialog without changing the personnel label', () => {
    expect(main).toContain("personnelEditor ? 'EMPLOYEE MASTER' : 'จัดการข้อมูล'");
    expect(main).not.toContain("personnelEditor ? 'EMPLOYEE MASTER' : 'SMS staging'");
  });

  it('describes unavailable LINE sending without an environment name', () => {
    expect(settings).toContain('title="การส่ง LINE ยังไม่เปิดใช้งาน"');
    expect(settings).toContain('สถานะปัจจุบัน: การส่ง LINE ยังไม่เปิดใช้งาน — การบันทึกด้านบนเก็บเฉพาะเทมเพลตที่ไม่มีข้อมูลลับ');
    expect(settings).not.toContain('การส่ง LINE ยังไม่เปิดใช้ใน staging');
    expect(settings).not.toContain('การส่ง LINE ยังไม่เปิดใช้งานใน staging');
  });

  it('keeps the LINE test control disabled and action-free', () => {
    expect(settings).toMatch(/<button type="button" className="btn-neutral small-action" disabled title="การส่ง LINE ยังไม่เปิดใช้งาน"><SmsIcon name="bell" size=\{15\} \/> ทดสอบส่งข้อความแจ้งเตือน<\/button>/);
    expect(settings).not.toMatch(/disabled title="การส่ง LINE ยังไม่เปิดใช้งาน"[^>]*onClick=/);
  });
});
