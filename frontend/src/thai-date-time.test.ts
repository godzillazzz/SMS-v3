import { describe, expect, it } from 'vitest';
import {
  bangkokDateInput,
  currentBangkokMonth,
  currentBangkokYear,
  formatThaiDate,
  formatThaiDateTime,
  formatThaiMonth,
  formatThaiMonthPickerLabel,
} from './thai-date-time';

describe('shared Thai date and time formatting', () => {
  it('uses Bangkok calendar boundaries while keeping date input values Gregorian ISO', () => {
    const justAfterBangkokNewYear = new Date('2026-12-31T17:00:00.000Z');
    expect(currentBangkokMonth(justAfterBangkokNewYear)).toBe('2027-01');
    expect(currentBangkokYear(justAfterBangkokNewYear)).toBe(2027);
    expect(bangkokDateInput(justAfterBangkokNewYear)).toBe('2027-01-01');
  });

  it('formats timestamps in Bangkok time with Buddhist years', () => {
    expect(formatThaiDate('2026-12-31T17:00:00.000Z')).toBe('1 ม.ค. 2570');
    expect(formatThaiDateTime('2026-12-31T17:00:00.000Z', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })).toContain('2570');
    expect(formatThaiDateTime('2026-12-31T17:00:00.000Z', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })).toContain('00:00:00');
  });

  it('keeps leap-day date values stable and month options in Gregorian API form', () => {
    expect(formatThaiDate('2024-02-29')).toBe('29 ก.พ. 2567');
    expect(formatThaiMonth('2026-10')).toBe('ตุลาคม พ.ศ. 2569');
    expect(formatThaiMonthPickerLabel('2026-10')).toBe('ตุลาคม 2569');
    expect(bangkokDateInput(new Date('2024-02-29T00:00:00.000Z'))).toBe('2024-02-29');
  });
});
