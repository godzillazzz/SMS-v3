import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./pages/patrol/PatrolCenterPage.tsx', import.meta.url), 'utf8');

describe('patrol round photo access', () => {
  it('shows the eye and scan time on desktop and mobile with descriptive photo labels', () => {
    expect((source.match(/<SmsIcon name="eye"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(source.match(/aria-label=\{photoLabel\(row\.code, cell\)\}/g)?.length).toBe(2);
    expect(source.match(/cell\.count > 1/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('ดูรูปจุดตรวจ ${code} รอบ ${cell.round} เวลา ${thaiTime(cell.lastScanAt)}');
  });
});
