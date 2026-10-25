import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { leaveDecisionPresentation } from './components/LeaveDecisionConfirmation';

const main = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf8');

describe('urgent UX fixes from the audit', () => {
  it('S-03: approving leave says AL replaces existing shifts for the exact range', () => {
    const text = leaveDecisionPresentation('approve', 'PENDING', { dateRange: '26–28 ต.ค. 2569', dayCount: '3' }).consequence;
    expect(text).toContain('26–28 ต.ค. 2569 (3 วัน)');
    expect(text).toContain('AL แทนกะเดิม');
    expect(text).toContain('ไม่ต้องอนุมัติใหม่');
  });

  it('S-03: cancelling approved leave says the slots become empty and need re-planning', () => {
    const text = leaveDecisionPresentation('cancel', 'APPROVED', { dateRange: '1–2 พ.ย. 2569', dayCount: '2' }).consequence;
    expect(text).toContain('ช่องนั้นจะว่าง');
    expect(text).toContain('ต้องจัดกะใหม่');
  });

  it('S-02: saving drafts on an approved month asks first and names re-approval', () => {
    const at = main.indexOf("title: 'บันทึกการแก้ตารางที่อนุมัติแล้ว'");
    expect(at).toBeGreaterThan(-1);
    const block = main.slice(at - 200, at + 400);
    expect(block).toContain("approval.status === 'APPROVED'");
    expect(block).toContain('สถานะจะกลับเป็นรออนุมัติ');
    expect(block).toContain('await saveAllDrafts()');
  });

  it('N-02: the attendance page is not handed a device action that does nothing', () => {
    expect(main).not.toContain('onOpenAttendanceDevice={() => undefined}');
  });
});
