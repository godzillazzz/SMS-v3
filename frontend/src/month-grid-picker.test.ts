// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { formatThaiMonth, normalizeMonthValue, parseMonthValue, shiftMonthValue } from './components/MonthGridPicker';
import { currentBangkokMonth } from './thai-date-time';
import { MonthGridPicker } from './components/MonthGridPicker';

const mainTsx = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf-8');
const pickerTsx = fs.readFileSync(path.join(__dirname, 'components', 'MonthGridPicker.tsx'), 'utf-8');
const stylesCss = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf-8');

afterEach(() => cleanup());

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

  test('shows the selected month and Buddhist year in Thai in the picker', async () => {
    render(createElement(MonthGridPicker, { value: '2026-10', onChange: () => undefined }));
    const trigger = screen.getByRole('button', { name: /ตุลาคม 2569/ });
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('grid', { name: 'เลือกเดือน' })).toBeTruthy());
    expect(screen.getByRole('gridcell', { name: 'ต.ค.' })).toBeTruthy();
  });

  test.each([1366, 375])('keeps the month picker inside the viewport at %ipx', async (width) => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    try {
      render(createElement(MonthGridPicker, { value: '2026-10', onChange: () => undefined }));
      fireEvent.click(screen.getByRole('button', { name: /ตุลาคม 2569/ }));
      const grid = await screen.findByRole('grid', { name: 'เลือกเดือน' });
      const panel = grid.parentElement;
      expect(panel).toBeTruthy();
      expect(Number.parseFloat(panel!.style.width)).toBeLessThanOrEqual(width - 32);
      expect(Number.parseFloat(panel!.style.left)).toBeGreaterThanOrEqual(16);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    }
  });

  test('reuses the picker on schedule and leave history with a body portal', () => {
    expect(mainTsx).toContain('<MonthGridPicker value={scheduleMonth} onChange={(value) => { setScheduleMonth(value); setOperationPage(1); }} />');
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
