import { describe, expect, it } from 'vitest';
import { coverageCellTone, formatPatrolPercent, parsePatrolQr, patrolDatesBetween, PATROL_QR_PREFIX, summarizeByDepartment } from './patrol-model';

describe('patrol model', () => {
  it('accepts only SMS patrol QR payloads', () => {
    expect(parsePatrolQr(`${PATROL_QR_PREFIX}${'a'.repeat(43)}`)).toBe(`${PATROL_QR_PREFIX}${'a'.repeat(43)}`);
    expect(parsePatrolQr('  ' + `${PATROL_QR_PREFIX}${'b'.repeat(43)}` + ' ')).toBe(`${PATROL_QR_PREFIX}${'b'.repeat(43)}`);
    expect(parsePatrolQr('https://example.com')).toBeNull();
    expect(parsePatrolQr(`${PATROL_QR_PREFIX}short`)).toBeNull();
    expect(parsePatrolQr('SITE-ATTENDANCE-TOKEN-xxxxxxxxxxxxxxxxxxxxxxxxx')).toBeNull();
  });

  it('builds inclusive date ranges in order', () => {
    expect(patrolDatesBetween('2026-10-29', '2026-11-01')).toEqual(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect(patrolDatesBetween('2026-10-30', '2026-10-29')).toEqual([]);
  });

  it('maps cells to scanned / pending / future tones', () => {
    expect(coverageCellTone({ count: 2 }, '2026-10-30', '2026-10-30')).toBe('done');
    expect(coverageCellTone({ count: 0 }, '2026-10-29', '2026-10-30')).toBe('missed');
    expect(coverageCellTone({ count: 0 }, '2026-10-30', '2026-10-30')).toBe('pending');
    expect(coverageCellTone({ count: 0 }, '2026-10-31', '2026-10-30')).toBe('future');
  });

  it('summarizes department completion', () => {
    const rows = summarizeByDepartment([
      { department: 'ANO', total: 4, scanned: 3 },
      { department: 'WCS', total: 2, scanned: 0 }
    ]);
    expect(rows).toEqual([
      { department: 'ANO', total: 4, scanned: 3, pending: 1, percent: 75 },
      { department: 'WCS', total: 2, scanned: 0, pending: 2, percent: 0 }
    ]);
    expect(formatPatrolPercent(66.6)).toBe('67%');
  });
});
