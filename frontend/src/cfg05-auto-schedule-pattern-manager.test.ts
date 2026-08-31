import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.tsx');
const client = read('auto-schedule-pattern-client.ts');
const panel = read('components/AutoSchedulePatternPanel.tsx');
const api = read('api.ts');

describe('CFG-05 Auto Schedule Pattern Manager', () => {
  it('uses a dedicated governed client while keeping central api.ts unchanged', () => {
    expect(client).toContain("getAutoSchedulePatterns");
    expect(client).toContain("createAutoSchedulePattern");
    expect(client).toContain("updateAutoSchedulePattern");
    expect(client).not.toContain("DELETE");
    expect(api).not.toContain("auto-schedule-patterns");
  });

  it('loads active patterns and phase options dynamically in the employee magic wand', () => {
    expect(main).toContain('getAutoSchedulePatterns(token)');
    expect(main).toContain('const selectedPattern = patterns.find');
    expect(main).toContain('selectedPattern?.mode === \'CYCLE\' ? selectedPattern.steps : []');
    expect(main).toContain('patterns.map((pattern, index)');
    expect(main).toContain('selectedPhaseOptions.map((step)');
    expect(main).toContain("api.previewEmployeeAutoSchedule(token, scheduleMonth, String(target.id), 'AUTO', patternType)");
    expect(main).not.toContain('<option value="D1">');
    expect(main).not.toContain("useState<'SUPERVISOR' | 'ROTATE'>");
  });

  it('fails closed when Pattern Master cannot be loaded instead of silently using hardcoded defaults', () => {
    expect(main).toContain("setPatternLoadError");
    expect(main).toContain("disabled={busy || !selectedPattern}");
    expect(main).toContain("ไม่พบ Auto Schedule Pattern ที่เปิดใช้งาน");
  });

  it('shows an Admin Pattern Manager with protected core routing and no Delete action', () => {
    expect(main).toContain('<AutoSchedulePatternPanel token={token} />');
    expect(panel).toContain('Auto Schedule Pattern Manager');
    expect(panel).toContain('Core SUPERVISOR / ROTATE ปิดใช้งาน');
    expect(panel).toContain('Custom pattern จะเป็น “เลือกเอง”');
    expect(panel).not.toMatch(/>ลบ Pattern</);
    expect(panel).toContain("targetGroup: 'MANUAL'");
  });

  it('removes hardcoded bulk pattern wording and describes the managed source instead', () => {
    expect(main).toContain('ใช้ Pattern Master เดียวกับไม้กายสิทธิ์รายบุคคล');
    expect(main).toContain('อ่านแพทเทิร์น Supervisor/พนักงานทั่วไปจากค่าที่ Admin จัดการ');
    expect(main).not.toContain('พนักงานทั่วไป 6D / OFF / 6N / OFF');
  });
});
