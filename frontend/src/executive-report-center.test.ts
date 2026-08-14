import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const app = read('main.tsx');
const page = read('pages/executive-report/ExecutiveReportCenterPage.tsx');
const styles = read('styles/executive-report.css');
const print = read('schedule-print.ts');

describe('Executive Report presentation and export contract', () => {
  it('preserves the existing executive API contract and ADMIN-only department scope control', () => {
    expect(page).toContain('api.executiveReport(token, { year, month, department: department || undefined })');
    expect(page).toContain("role === 'ADMIN'");
    expect(page).toContain('filters?: ExecutiveReportFilters');
    expect(page).toContain('embedded?: boolean');
    expect(page).toContain('onReportChange?(report?: ExecutiveReport): void');
  });

  it('keeps all existing management sections, deep links, and safe states reusable inside the unified center', () => {
    for (const label of ['รายงานผู้บริหาร', 'กำลังพลและการจัดเวร', 'การลา', 'สถานะใบอนุญาต', 'คุณภาพข้อมูล', 'ประเด็นที่ผู้บริหารควรติดตาม', 'ส่งออก PDF']) expect(page).toContain(label);
    expect(page).toContain('ไม่สามารถโหลดรายงานผู้บริหารได้ กรุณาลองใหม่อีกครั้ง');
    expect(page).toContain('ไม่พบประเด็นสำคัญที่ต้องติดตามในช่วงเวลานี้');
    expect(page).toContain("onNavigate('leaveHistory')");
    expect(page).toContain("onNavigate('licenses')");
  });

  it('keeps legacy report page IDs internally compatible while the new center owns rendering', () => {
    expect(app).toContain("executiveReport: 'reportCenter'");
    expect(app).toContain("reports: 'reportCenter'");
    expect(app).toContain("activePage === 'reportCenter' || activePage === 'executiveReport' || activePage === 'reports'");
  });

  it('uses responsive grids without page-level horizontal layout and protects Thai action controls', () => {
    expect(styles).toContain('grid-template-columns:repeat(5,minmax(0,1fr))');
    expect(styles).toContain('@media (max-width:760px)');
    expect(styles).toContain('@media (max-width:430px)');
    expect(styles).toContain('white-space:nowrap');
    expect(styles).toContain('min-width:0');
    expect(styles).not.toContain('min-width: 100vw');
  });

  it('prints an isolated report document with no interactive controls and no blank-first-page break', () => {
    const printSegment = page.slice(page.indexOf('export function ExecutiveReportPrint'), page.indexOf('function PrintSection'));
    expect(page).toContain('className="print-only executive-report-print"');
    expect(page).toContain('className="executive-report-print-page"');
    expect(styles).toContain('break-before:auto');
    expect(styles).toContain('page-break-before:auto');
    expect(print).toContain('export async function printDocument(selector: string, title: string');
    expect(page).toContain("printDocument('.executive-report-print', filename)");
    expect(printSegment).not.toContain('<button');
  });
});