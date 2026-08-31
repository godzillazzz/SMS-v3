import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('CFG-02 Leave Policy configuration contract', () => {
  const main = read('main.tsx');
  const card = read('components/LeavePolicySettingsCard.tsx');
  const client = read('leave-policy-client.ts');
  const api = read('api.ts');

  it('adds Leave Policy to Configuration Center with six governed settings and immutable invariants', () => {
    expect(main).toContain('<LeavePolicySettingsCard settings={settings} onSave={onSaveLeavePolicy} onRefresh={onRefresh} />');
    expect(main).toContain('leavePolicyKeys.defaultSickDays');
    expect(main).toContain('leavePolicyKeys.defaultPersonalDays');
    expect(main).toContain('leavePolicyKeys.defaultVacationDays');
    expect(main).toContain('leavePolicyKeys.sickAttachmentRequiredAfterDays');
    expect(main).toContain('leavePolicyKeys.managerRetroactiveOnBehalfEnabled');
    expect(main).toContain('leavePolicyKeys.managerRetroactiveMaxDaysBack');
    expect(card).toContain('Viewer ย้อนหลังไม่ได้');
    expect(card).toContain('Manager ห้ามย้อนหลังให้ตัวเอง');
    expect(card).toContain('ห้ามอนุมัติคำขอของตนเอง');
  });

  it('loads resolved Leave Policy through a dedicated read-only client while leaving central api.ts untouched', () => {
    expect(client).toContain('/leave-policy');
    expect(client).toContain("method: 'GET'");
    expect(client).toContain("cache: 'no-store'");
    expect(client).toContain("credentials: 'include'");
    expect(client).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/);
    expect(main).toContain('getLeavePolicy(auth.token)');
    expect(api).not.toContain("leavePolicy: (token");
  });

  it('uses resolved policy for quota defaults, sick attachment threshold and Manager retroactive pre-blocking', () => {
    expect(main).toContain('leaveQuotaDefaultsFromPolicy(leavePolicy)');
    expect(main).toContain('leavePolicy.sickAttachmentRequiredAfterDays');
    expect(main).toContain('days > attachmentThresholdDays');
    expect(main).toContain('leavePolicy.managerRetroactiveOnBehalfEnabled');
    expect(main).toContain('leavePolicy.managerRetroactiveMaxDaysBack');
    expect(main).toContain('managerRetroactiveBlocked');
    expect(main).toContain('Manager ไม่สามารถบันทึกการลาย้อนหลังให้ตนเองได้');
    expect(main).toContain('นโยบายปัจจุบันไม่อนุญาตให้ Manager บันทึกการลาย้อนหลังแทนพนักงาน');
    expect(main).not.toContain("form.leaveType.includes('ป่วย') && days > 3");
  });

  it('states that quota defaults affect only new annual rows and do not rewrite historical evidence', () => {
    expect(card).toContain('ใช้เฉพาะเมื่อระบบสร้างโควตารายปีใหม่');
    expect(card).toContain('โควตาที่มีอยู่แล้วจะไม่ถูกเขียนทับ');
    expect(card).toContain('ไม่แก้โควตาหรือคำขอลาในอดีตย้อนหลัง');
    expect(card).toContain('มีผลกับการตัดสินใจและการสร้างข้อมูลใหม่หลังบันทึกเท่านั้น');
  });
});
