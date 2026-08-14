import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const app = read('main.tsx');
const page = read('pages/reports/ReportCenterPage.tsx');
const executive = read('pages/executive-report/ExecutiveReportCenterPage.tsx');
const api = read('api.ts');
const styles = read('styles/report-center.css');

describe('Unified Report Center V1 source contract', () => {
  it('shows exactly one reporting navigation entry with the new label', () => {
    const navSegment = app.slice(app.indexOf("{ label: 'รายงาน'"), app.indexOf("{ label: 'ตั้งค่า'"));
    expect(navSegment).toContain("{ id: 'reportCenter', icon: '▤', label: 'รายงานและวิเคราะห์' }");
    expect(navSegment).not.toContain("id: 'executiveReport'");
    expect(navSegment).not.toContain("id: 'reports'");
    expect(navSegment).not.toContain('รายงานผู้บริหาร');
    expect(navSegment).not.toContain('รายงานและ Export');
  });

  it('provides three accessible tabs and defaults to Executive Overview', () => {
    expect(page).toContain("initialTab = 'executive'");
    expect(page).toContain('role="tablist"');
    expect(page).toContain('role="tab"');
    expect(page).toContain('aria-selected={activeTab === \'executive\'}');
    for (const label of ['ภาพรวมผู้บริหาร', 'รายงานรายละเอียด', 'Export']) expect(page).toContain(label);
  });

  it('keeps shared month/year/department filter state while preserving backend support boundaries', () => {
    expect(page).toContain('useState<ExecutiveReportFilters>');
    expect(page).toContain('filters={filters} onFiltersChange={setFilters}');
    expect(page).toContain("role === 'ADMIN'");
    expect(page).toContain('api.reportSummary(token)');
    expect(page).not.toContain('api.reportSummary(token,');
    expect(page).toContain('backend ยังไม่รองรับ');
  });

  it('reuses the existing Executive Report and report-summary API contracts without backend changes', () => {
    expect(page).toContain('<ExecutiveReportCenterPage');
    expect(executive).toContain('api.executiveReport(token, { year, month, department: department || undefined })');
    expect(api).toContain("executiveReport: (token: string, filters: { year?: number; month?: number; department?: string } = {})");
    expect(api).toContain("reportSummary: (token: string) => call('/reports/summary'");
  });

  it('exposes only the existing PDF export capability and keeps an isolated print document mounted', () => {
    expect(page).toContain("printDocument('.executive-report-print', pdfFilename)");
    expect(page).toContain('รายงานผู้บริหาร PDF');
    expect(page).toContain('รูปแบบที่รองรับ: PDF');
    expect(page).toContain('<ExecutiveReportPrint report={executiveReport} />');
    expect(page).not.toContain('Export Excel');
  });

  it('preserves report RBAC and legacy internal compatibility', () => {
    expect(app).toContain("if (['licenses', 'reportCenter', 'reports', 'executiveReport'].includes(page)) return ['ADMIN', 'MANAGER'].includes(auth.user?.role || '');");
    expect(app).toContain("executiveReport: 'reportCenter'");
    expect(app).toContain("reports: 'reportCenter'");
    expect(app).toContain("const initialTab = activePage === 'reports' ? 'details' : 'executive';");
  });

  it('contains loading, error, empty, keyboard-focus, tablet and mobile states', () => {
    for (const text of ['กำลังสรุปข้อมูล…', 'ไม่สามารถโหลดรายงานรายละเอียด', 'ยังไม่มีข้อมูลสรุป', 'กำลังเตรียมข้อมูลสำหรับส่งออก']) expect(page).toContain(text);
    expect(styles).toContain(':focus-visible');
    expect(styles).toContain('@media (max-width:760px)');
    expect(styles).toContain('@media (max-width:430px)');
    expect(styles).toContain('overflow-x:auto');
  });
});

describe('Performance Hardening V1 report request contract', () => {
  it('suppresses hidden Executive fetches and protects stale export', () => {
    expect(executive).toContain('fetchEnabled?: boolean'); expect(executive).toContain('if (!fetchEnabled || loadedKey === requestKey)'); expect(page).toContain("fetchEnabled={activeTab === 'executive' || activeTab === 'export'}"); expect(page).toContain('setExecutiveReport(undefined)'); expect(page).toContain('disabled={!executiveReport}');
  });
  it('loads Details once per token until explicit refresh', () => {
    expect(page).toContain("if (activeTab !== 'details' || summaryLoaded) return;"); expect(page).toContain('setSummaryLoaded(true)'); expect(page).toContain('setSummaryLoaded(false); setSummaryRefresh'); expect(page).toContain('}, [token]);');
  });
});
