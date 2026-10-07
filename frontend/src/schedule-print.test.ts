import { describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { printScheduleDocument } from './schedule-print';

const mainTsx = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf-8');
const stylesCss = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf-8');
const printHelper = fs.readFileSync(path.join(__dirname, 'schedule-print.ts'), 'utf-8');

describe('schedule PDF export', () => {
  test('waits for the browser paint cycle before calling the test print fallback', async () => {
    const print = vi.fn();
    const pendingPrint = printScheduleDocument(print);

    expect(print).not.toHaveBeenCalled();
    await pendingPrint;
    expect(print).toHaveBeenCalledOnce();
  });

  test('renders an explicit empty-state page instead of an empty print root', () => {
    expect(mainTsx).toContain('className="print-empty-state"');
    expect(mainTsx).toContain('ไม่พบข้อมูลตารางกะสำหรับเดือนนี้');
    expect(mainTsx).toContain('sortScheduleEmployeesByDepartment(rawCalendarEmployees)');
    expect(mainTsx).toContain("const printDepartments = Array.from(new Set(calendarEmployees.map((e) => String(e.department ?? '').trim())));");
  });

  test('uses print-safe fragmentation rules for multi-page schedules', () => {
    expect(mainTsx).toContain("import { printDocument, printScheduleDocument, printTableReport } from './schedule-print';");
    expect(mainTsx).toContain('onClick={() => void printScheduleDocument()}');
    expect(printHelper).toContain("printDocument('.print-only', 'Schedule PDF'");
    expect(printHelper).toContain("document.createElement('iframe')");
    expect(printHelper).toContain("frameWindow.addEventListener('afterprint', cleanup");
    expect(printHelper).toContain('copyPrintStyles(document, frameDocument)');
    expect(printHelper).toContain('preparePrintLayout(frameDocument, options.orientation');
    expect(printHelper).toContain('frameDocument.body.append(printRoot.cloneNode(true))');
    expect(printHelper).toContain('@page { size: A4 ${orientation}; margin: ${margin}; }');
    expect(printHelper).toContain("'landscape', margin: '8mm 10mm'");
    expect(stylesCss).not.toContain('@page');
    expect(stylesCss).toContain('min-height: 0 !important;');
    expect(stylesCss).toContain('position: static !important;');
    expect(stylesCss).toContain('break-after: page;');
    expect(stylesCss).toContain('break-inside: auto !important;');
    expect(stylesCss).toContain('display: table-header-group;');
    expect(stylesCss).toContain('page-break-inside: avoid !important;');
  });

  test('uses 7pt shift cells and compact fixed-width date columns for 31 days', () => {
    expect(printHelper).toContain('font-size: 7pt !important;');
    expect(printHelper).toContain('width: 6mm !important;');
    expect(printHelper).toContain('nth-child(-n+34)');
    expect(printHelper).toContain('.print-department-group-row + tr');
  });

  test('generic table and audit reports use isolated table print documents', () => {
    expect(mainTsx).toContain("printTableReport('.signature-data-table'");
    expect(mainTsx).toContain("printTableReport('.audit-table'");
    expect(printHelper).toContain('display: table-header-group !important');
    expect(printHelper).toContain('break-inside: avoid !important');
    expect(printHelper).toContain("columnCount > 7 ? 'landscape' : 'portrait'");
  });

  test('leave and report print requests declare their own page geometry', () => {
    expect(mainTsx).toContain("orientation: 'portrait', margin: '12mm'");
    expect(printHelper).toContain("orientation: 'landscape', margin: '8mm 10mm'");
    expect(printHelper).toContain("margin: '10mm'");
  });
});
