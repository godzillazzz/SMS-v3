import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { currentBangkokMonth, formatThaiMonth, normalizeMonthValue, parseMonthValue, shiftMonthValue } from './components/MonthGridPicker';

const mainTsx = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf-8');
const pickerTsx = fs.readFileSync(path.join(__dirname, 'components', 'MonthGridPicker.tsx'), 'utf-8');
const stylesCss = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf-8');

describe('MonthGridPicker month behavior', () => {
  test('uses Bangkok month without a UTC date shift', () => {
    expect(currentBangkokMonth(new Date('2026-01-31T18:00:00.000Z'))).toBe('2026-02');
  });

  test('normalizes URL values and falls back safely', () => {
    expect(parseMonthValue('2026-8')).toEqual({ year: 2026, month: 8 });
    expect(normalizeMonthValue('not-a-month', '2026-08')).toBe('2026-08');
  });

  test('moves across year boundaries', () => {
    expect(shiftMonthValue('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthValue('2026-12', 1)).toBe('2027-01');
  });

  test('formats Thai month and year', () => {
    expect(formatThaiMonth('2026-08')).toBe('สิงหาคม พ.ศ. 2569');
  });

  test('reuses the picker on schedule and leave history with a body portal', () => {
    expect(mainTsx).toContain('<MonthGridPicker value={scheduleMonth} onChange={setScheduleMonth} />');
    expect(mainTsx).toContain('<MonthGridPicker value={historyMonth} onChange={onHistoryMonthChange} />');
    expect(pickerTsx).toContain('createPortal(');
    expect(pickerTsx).toContain("document.getElementById('modal-root')");
    expect(stylesCss).toContain('.month-grid-panel-portal');
    expect(stylesCss).toMatch(/\.month-grid-panel\s*\{[^}]*position: fixed;/s);
  });

  test('supports URL history, keyboard, Escape, and outside-click behavior', () => {
    expect(mainTsx).toContain('new URLSearchParams(window.location.search)');
    expect(mainTsx).toContain('window.history.pushState');
    expect(mainTsx).toContain('window.addEventListener(\'popstate\', handlePopState)');
    expect(pickerTsx).toContain("event.key === 'Escape'");
    expect(pickerTsx).toContain("document.addEventListener('pointerdown'");
    expect(pickerTsx).toContain("event.key === 'ArrowLeft'");
  });
});
