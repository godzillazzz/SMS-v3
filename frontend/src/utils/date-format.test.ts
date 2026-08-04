import { describe, expect, it } from 'vitest';
import { formatBuddhistYear, formatThaiDate, formatThaiDateTime, formatThaiMonthYear, parseBuddhistYearInput, toIsoDate } from './date-format';

describe('Thai Buddhist date presentation', () => {
  it('formats Gregorian dates as Buddhist dates', () => {
    expect(formatThaiDate('2026-08-04')).toBe('4 สิงหาคม 2569');
    expect(formatThaiDate('2026-01-01')).toBe('1 มกราคม 2569');
    expect(formatThaiDate('2025-12-31')).toBe('31 ธันวาคม 2568');
    expect(formatThaiDate('2024-02-29')).toBe('29 กุมภาพันธ์ 2567');
  });
  it('returns a safe fallback for invalid values', () => {
    expect(formatThaiDate(null)).toBe('-');
    expect(formatThaiDate('not-a-date')).toBe('-');
  });
  it('does not double-convert years and preserves ISO input', () => {
    expect(formatThaiDate('2569-08-04')).toBe('-');
    expect(formatBuddhistYear(2026)).toBe('2569');
    expect(parseBuddhistYearInput('2569')).toBe(2026);
    expect(parseBuddhistYearInput('2026')).toBe(2026);
    expect(toIsoDate('2026-08-04')).toBe('2026-08-04');
  });
  it('formats month/year and Bangkok date/time', () => {
    expect(formatThaiMonthYear('2026-08-01')).toBe('สิงหาคม 2569');
    expect(formatThaiDateTime('2026-08-04T07:30:00Z')).toContain('4 สิงหาคม 2569 เวลา 14:30 น.');
  });
});
