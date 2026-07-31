import { describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { printScheduleDocument } from './schedule-print';

const mainTsx = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf-8');
const stylesCss = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf-8');
const printHelper = fs.readFileSync(path.join(__dirname, 'schedule-print.ts'), 'utf-8');

describe('schedule PDF export', () => {
  test('waits for the browser paint cycle before calling print', async () => {
    const print = vi.fn();
    const pendingPrint = printScheduleDocument(print);

    expect(print).not.toHaveBeenCalled();
    await pendingPrint;
    expect(print).toHaveBeenCalledOnce();
  });

  test('renders an explicit empty-state page instead of an empty print root', () => {
    expect(mainTsx).toContain('className="print-empty-state"');
    expect(mainTsx).toContain('ไม่พบข้อมูลตารางกะสำหรับเดือนนี้');
  });

  test('uses print-safe fragmentation rules for multi-page schedules', () => {
    expect(mainTsx).toContain("import { printScheduleDocument } from './schedule-print';");
    expect(mainTsx).toContain('onClick={() => void printScheduleDocument()}');
    expect(printHelper).toContain("classList.add('schedule-printing')");
    expect(printHelper).toContain("addEventListener('afterprint', cleanup");
    expect(stylesCss).toContain('html.schedule-printing .app-shell');
    expect(stylesCss).toContain('html.schedule-printing .print-only');
    expect(stylesCss).toContain('size: A4 landscape;');
    expect(stylesCss).toContain('min-height: 0 !important;');
    expect(stylesCss).toContain('#root');
    expect(stylesCss).toContain('position: static !important;');
    expect(stylesCss).toContain('break-after: page;');
    expect(stylesCss).toContain('break-inside: auto !important;');
    expect(stylesCss).toContain('display: table-header-group;');
    expect(stylesCss).toContain('page-break-inside: avoid !important;');
  });
});
