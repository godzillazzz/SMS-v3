import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const main = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf8').replace(/\r\n/g, '\n');

describe('Owner-approved monthly roster icon contract', () => {
  it('retains the original magic wand for individual auto-schedule actions', () => {
    expect(main).toContain('<h2 id="magic-wand-title">🪄 จัดกะแพทเทิร์นด่วน</h2>');
    expect(main).toMatch(/className="employee-magic-button"[\s\S]{0,250}\{isSchedulingEmployee \? '…' : '🪄'\}/);
    expect(main).toContain('onClick={() => openEmployeeScheduleWizard(employee)}');
  });

  it('retains the original sparkle and magic wand for bulk auto-schedule preview', () => {
    expect(main).toContain("{autoScheduleBusy ? 'กำลังคำนวณ…' : '✨ ดูตัวอย่างจัดกะอัตโนมัติ'}");
    expect(main).toContain('>🪄 ตัวอย่างตารางจัดกะอัตโนมัติ ( Auto Schedule Preview )</h2>');
    expect(main).toContain('onClick={saveAutoSchedule}>🪄 ใส่ลงในฉบับร่าง (ยังไม่บันทึก)</button>');
    expect(main).toContain('api.previewAutoSchedule(auth.token, scheduleMonth)');
  });

  it('keeps locked shift and license override visually distinct and accessible', () => {
    expect(main).toContain('role="img" aria-label="กะล็อก" title="กะที่ล็อก">🔒</span>');
    expect(main).toContain('data-label-type="override"');
    expect(main).toContain('>OVERRIDE ⚡</small>');
    expect(main).toContain('data-label-type="manual"');
    expect(main).toContain('data-label-type="license-block"');
    expect(main).not.toContain('title="กะที่ล็อก"><SmsIcon name="shield" />');
    expect(main).not.toContain('>OVERRIDE <SmsIcon name="shield" />');
  });

  it('guards against replacing approved roster symbols with generic settings icons', () => {
    expect(main).not.toContain('onClick={saveAutoSchedule}><SmsIcon name="settings" />');
    expect(main).not.toContain('<SmsIcon name="settings" /> ตัวอย่างตารางจัดกะอัตโนมัติ');
    expect(main).not.toContain("{isSchedulingEmployee ? '…' : <SmsIcon name=\"settings\" />}");
  });
});
