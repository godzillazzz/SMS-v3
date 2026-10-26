import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { describeRuleViolation } from './schedule-rule-text';

describe('S-01 rule results in Thai', () => {
  it('translates every rule the service emits and keeps the date for "ไปที่วัน"', () => {
    const leave = describeRuleViolation({ ruleId: 'RULE005', title: 'Shift conflicts with approved leave on 2026-10-22', severity: 'error' });
    expect(leave).toMatchObject({ severity: 'error', severityLabel: 'ขัดกฎ', date: '2026-10-22' });
    expect(leave.title).toMatch(/^มีกะทับวันลาที่อนุมัติแล้ว · /);
    expect(describeRuleViolation({ ruleId: 'RULE006', title: 'No Supervisor scheduled on 2026-10-24', severity: 'warning' }).title).toMatch(/^ไม่มีหัวหน้างานเข้ากะ · /);
    expect(describeRuleViolation({ ruleId: 'RULE006', title: 'Supervisor working on Sunday 2026-10-25', severity: 'warning' }).severityLabel).toBe('ควรตรวจ');
    expect(describeRuleViolation({ ruleId: 'LICENSE', title: 'Invalid License on 2026-10-21', severity: 'error' }).title).toMatch(/ใบอนุญาตไม่ผ่าน/);
    const hours = describeRuleViolation({ ruleId: 'RULE001', title: 'Weekly hours exceeded (56h > 48h)', description: 'Employee สมชาย ใจดี exceeded weekly hours limit in 2026-W43.', severity: 'error' });
    expect(hours.title).toBe('ชั่วโมงทำงานต่อสัปดาห์เกิน (56 > 48 ชม.)');
    expect(hours.detail).toBe('สมชาย ใจดี · สัปดาห์ 2026-W43');
    expect(hours.date).toBeUndefined();
  });

  it('keeps unknown rules readable instead of hiding them', () => {
    expect(describeRuleViolation({ ruleId: 'RULE999', title: 'Custom rule', severity: 'warning' }).title).toBe('Custom rule');
  });

  it('keeps the rule-check panel and API available without mounting it in the roster', () => {
    const panel = fs.readFileSync(path.join(__dirname, 'ScheduleRuleChecksPanel.tsx'), 'utf8');
    expect(panel).toContain('api.ruleChecks(token, month)');
    expect(panel).not.toMatch(/fetch\(/);
    const main = fs.readFileSync(path.join(__dirname, '../../main.tsx'), 'utf8');
    expect(main).not.toContain('<ScheduleRuleChecksPanel');
    expect(main).toContain('บันทึกแล้วจะกลับเป็น "รออนุมัติ"');
  });
});
