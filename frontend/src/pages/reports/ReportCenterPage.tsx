import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { printDocument } from '../../schedule-print';
import {
  ExecutiveReportCenterPage,
  ExecutiveReportPrint,
  monthNames,
  type ExecutiveReport,
  type ExecutiveReportFilters
} from '../executive-report/ExecutiveReportCenterPage';
import '../../styles/report-center.css';

type ReportTab = 'executive' | 'details' | 'export';
type ReportSummary = Record<string, unknown>;

const summaryCards: Array<[string, keyof ReportSummary]> = [
  ['พนักงานทั้งหมด', 'employees'],
  ['พนักงานที่ใช้งาน', 'activeEmployees'],
  ['ใบอนุญาต', 'licenses'],
  ['รายการกะ', 'shifts'],
  ['คำขอลา', 'leaveRequests'],
  ['โควตาวันลา', 'leaveQuotas'],
  ['บัญชีผู้ใช้', 'users']
];

function currentBangkokPeriod() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value)
  };
}

function printableFilename(report?: ExecutiveReport, department = '') {
  if (!report) return 'SMS-V3-Executive-Report.pdf';
  const suffix = department ? `-${department.replace(/[^a-zA-Z0-9_-]+/g, '-')}` : '';
  return `SMS-V3-Executive-Report-${report.period.year}-${String(report.period.month).padStart(2, '0')}${suffix}.pdf`;
}

export function ReportCenterPage({ token, role, onNavigate, initialTab = 'executive' }: { token: string; role: string; onNavigate(page: string): void; initialTab?: ReportTab }) {
  const current = currentBangkokPeriod();
  const [activeTab, setActiveTab] = useState<ReportTab>(initialTab);
  const [filters, setFilters] = useState<ExecutiveReportFilters>({ year: current.year, month: current.month, department: '' });
  const [executiveReport, setExecutiveReport] = useState<ExecutiveReport>();
  const [summary, setSummary] = useState<ReportSummary>();
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string>();
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  const years = useMemo(() => Array.from({ length: 4 }, (_, index) => current.year - index), [current.year]);
  const departmentOptions = executiveReport?.scope.availableDepartments || [];
  const pdfFilename = printableFilename(executiveReport, filters.department);

  useEffect(() => {
    if (activeTab !== 'details') return;
    let active = true;
    setSummaryLoading(true);
    setSummaryError(undefined);
    api.reportSummary(token)
      .then((response) => { if (active) setSummary((!Array.isArray(response.data) ? response.data : {}) as ReportSummary); })
      .catch(() => { if (active) setSummaryError('ไม่สามารถโหลดรายงานรายละเอียดได้ กรุณาลองใหม่อีกครั้ง'); })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [activeTab, token, summaryRefresh]);

  const exportPdf = () => {
    if (!executiveReport) return;
    printDocument('.executive-report-print', pdfFilename);
  };

  return <section className="report-center-page view-pane" aria-label="ศูนย์รายงานและวิเคราะห์">
    <header className="report-center-heading">
      <div><p className="eyebrow">UNIFIED REPORT CENTER</p><h1>รายงานและวิเคราะห์</h1><p>Executive &amp; Operational Report Center</p></div>
      {(activeTab === 'executive' || activeTab === 'export') && <div className="report-center-quick-export" aria-label="ส่งออกด่วน"><button type="button" className="btn-primary" disabled={!executiveReport} onClick={exportPdf}>ส่งออก PDF</button></div>}
    </header>

    <section className="report-center-filter-card" aria-label="ตัวกรองรายงาน">
      <div className="report-center-filter-heading"><div><strong>ช่วงรายงาน</strong><small>คงค่าตัวกรองไว้เมื่อสลับแท็บที่รองรับ</small></div></div>
      <div className="report-center-filters">
        <label><span>เดือน</span><select value={filters.month} onChange={(event) => setFilters((value) => ({ ...value, month: Number(event.target.value) }))}>{monthNames.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></label>
        <label><span>ปี</span><select value={filters.year} onChange={(event) => setFilters((value) => ({ ...value, year: Number(event.target.value) }))}>{years.map((item) => <option key={item} value={item}>พ.ศ. {item + 543}</option>)}</select></label>
        {role === 'ADMIN' && <label><span>หน่วยงาน</span><select value={filters.department} onChange={(event) => setFilters((value) => ({ ...value, department: event.target.value }))}><option value="">ทุกหน่วยงาน</option>{departmentOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
      </div>
      {activeTab === 'details' && <p className="report-center-filter-note">รายงานรายละเอียดใช้ยอดรวมปัจจุบันจาก API เดิม และไม่ส่งตัวกรองช่วงเวลา/หน่วยงานที่ backend ยังไม่รองรับ</p>}
    </section>

    <div className="report-center-tabs" role="tablist" aria-label="ประเภทรายงาน">
      <button type="button" role="tab" aria-selected={activeTab === 'executive'} className={activeTab === 'executive' ? 'active' : ''} onClick={() => setActiveTab('executive')}>ภาพรวมผู้บริหาร</button>
      <button type="button" role="tab" aria-selected={activeTab === 'details'} className={activeTab === 'details' ? 'active' : ''} onClick={() => setActiveTab('details')}>รายงานรายละเอียด</button>
      <button type="button" role="tab" aria-selected={activeTab === 'export'} className={activeTab === 'export' ? 'active' : ''} onClick={() => setActiveTab('export')}>Export</button>
    </div>

    <div role="tabpanel" hidden={activeTab !== 'executive'} className="report-center-tab-panel">
      <ExecutiveReportCenterPage token={token} role={role} onNavigate={onNavigate} filters={filters} onFiltersChange={setFilters} embedded includePrint={false} onReportChange={setExecutiveReport} />
    </div>

    <div role="tabpanel" hidden={activeTab !== 'details'} className="report-center-tab-panel">
      <section className="report-center-section-heading"><div><p className="eyebrow">DETAILED REPORTS</p><h2>รายงานรายละเอียด</h2><p>สรุปข้อมูลปฏิบัติงานจากชุดข้อมูลและ API เดิม โดยไม่เปลี่ยนสูตรคำนวณ</p></div><button type="button" className="btn-neutral small-action" disabled={summaryLoading} onClick={() => setSummaryRefresh((value) => value + 1)}>↻ รีเฟรช</button></section>
      {summaryLoading && <div className="report-center-state" role="status">กำลังสรุปข้อมูล…</div>}
      {summaryError && <div className="report-center-state report-center-state--error" role="alert"><strong>ไม่สามารถโหลดรายงานรายละเอียด</strong><span>{summaryError}</span></div>}
      {!summaryLoading && !summaryError && summary && <div className="metrics-grid report-grid">{summaryCards.map(([label, key]) => <article className="metric-card" key={String(key)}><span className="metric-icon blue">▦</span><div><p>{label}</p><strong>{String(summary[key] ?? 0)}</strong><small>รายการปัจจุบัน</small></div></article>)}</div>}
      {!summaryLoading && !summaryError && summary && summaryCards.every(([, key]) => Number(summary[key] || 0) === 0) && <div className="report-center-state"><strong>ยังไม่มีข้อมูลสรุป</strong><span>ไม่พบรายการในชุดข้อมูลรายงานปัจจุบัน</span></div>}
    </div>

    <div role="tabpanel" hidden={activeTab !== 'export'} className="report-center-tab-panel">
      <section className="report-center-section-heading"><div><p className="eyebrow">ADVANCED EXPORT</p><h2>Export</h2><p>รวมเฉพาะรูปแบบส่งออกที่ระบบรองรับจริงในปัจจุบัน</p></div></section>
      <div className="report-center-export-grid">
        <article className="report-center-export-card"><div className="report-center-export-icon">PDF</div><div><h3>รายงานผู้บริหาร PDF</h3><p>ใช้ข้อมูลและตัวกรองเดียวกับแท็บภาพรวมผู้บริหาร พร้อมรูปแบบเอกสาร A4 ที่มีอยู่เดิม</p><small>รูปแบบที่รองรับ: PDF</small></div><button type="button" className="btn-primary" disabled={!executiveReport} onClick={exportPdf}>ส่งออก PDF</button></article>
      </div>
      {!executiveReport && <div className="report-center-state" role="status"><strong>กำลังเตรียมข้อมูลสำหรับส่งออก</strong><span>รอข้อมูล Executive Report จาก API เดิม</span></div>}
    </div>

    {executiveReport && <ExecutiveReportPrint report={executiveReport} />}
  </section>;
}