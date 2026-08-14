import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { printDocument } from '../../schedule-print';
import '../../styles/executive-report.css';

type ReportItem = { label: string; count: number };
type Attention = { severity: string; title: string; description: string; count: number; targetPath?: string };
export type ExecutiveReport = {
  period: { year: number; month: number; startDate: string; endDate: string; label: string };
  scope: { departmentName: string; allowsDepartmentFilter: boolean; availableDepartments: string[] };
  executiveSummary: Array<{ key: string; label: string; value: number; unit: string; status: string }>;
  workforce: { totalEmployees: number; activeEmployees: number; byDepartment: ReportItem[] };
  schedule: { assignmentCount: number; periodNote: string };
  leave: { totalRequests: number; statusCounts: Record<string, number>; byType: ReportItem[]; overlapRule: string };
  license: { expired: number; expiringWithin30Days: number; validBeyond30Days: number; pendingReview: number; asOfDate: string };
  dataQuality: { total: number; critical: number; warning: number; info: number; categories: Array<ReportItem & { rule: string; severity: string; module: string; title: string }> };
  managementAttention: Attention[];
  generatedAt: string;
};

export type ExecutiveReportFilters = { year: number; month: number; department: string };
export const monthNames = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, index, 1))));
const thaiNumber = (value: number) => new Intl.NumberFormat('th-TH').format(value);
const formatDateTime = (value: string) => new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value));

function Chart({ title, items }: { title: string; items: ReportItem[] }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return <section className="executive-report-chart" aria-label={title}><h3>{title}</h3>{items.length ? items.slice(0, 6).map((item) => <div className="executive-report-bar" key={item.label}><span>{item.label}</span><div><i style={{ width: `${Math.max(4, (item.count / max) * 100)}%` }} /></div><b>{thaiNumber(item.count)}</b></div>) : <p className="executive-report-empty">ไม่มีข้อมูลในช่วงที่เลือก</p>}</section>;
}

export function ExecutiveReportPrint({ report }: { report: ExecutiveReport }) {
  return <article className="print-only executive-report-print" aria-hidden="true">
    <section className="executive-report-print-page">
      <header><p>SECURITY MANAGEMENT SYSTEM V3</p><h1>รายงานผู้บริหาร</h1><span>{report.period.label} · {report.scope.departmentName}</span><small>สร้างรายงาน {formatDateTime(report.generatedAt)}</small></header>
      <div className="executive-report-print-kpis">{report.executiveSummary.map((item) => <div key={item.key}><span>{item.label}</span><strong>{thaiNumber(item.value)} <small>{item.unit}</small></strong></div>)}</div>
      <PrintSection title="กำลังพลและการจัดเวร"><p>พนักงานทั้งหมด {thaiNumber(report.workforce.totalEmployees)} คน · พนักงานที่ปฏิบัติงาน {thaiNumber(report.workforce.activeEmployees)} คน · รายการจัดเวร {thaiNumber(report.schedule.assignmentCount)} รายการ</p><PrintList items={report.workforce.byDepartment} /></PrintSection>
      <PrintSection title="การลา"><p>คำขอลาที่ทับซ้อนกับช่วงเวลา {thaiNumber(report.leave.totalRequests)} รายการ · รอพิจารณา {thaiNumber(report.leave.statusCounts.PENDING || 0)} · อนุมัติ {thaiNumber(report.leave.statusCounts.APPROVED || 0)}</p><PrintList items={report.leave.byType} /></PrintSection>
      <PrintSection title="สถานะใบอนุญาต"><p>หมดอายุ {thaiNumber(report.license.expired)} · ใกล้หมดอายุภายใน 30 วัน {thaiNumber(report.license.expiringWithin30Days)} · ใช้งานได้เกิน 30 วัน {thaiNumber(report.license.validBeyond30Days)} · รอตรวจสอบ {thaiNumber(report.license.pendingReview)}</p></PrintSection>
      <PrintSection title="คุณภาพข้อมูล"><p>รวม {thaiNumber(report.dataQuality.total)} รายการ · วิกฤต {thaiNumber(report.dataQuality.critical)} · เตือน {thaiNumber(report.dataQuality.warning)} · ข้อมูล {thaiNumber(report.dataQuality.info)}</p><PrintList items={report.dataQuality.categories.map((item) => ({ label: item.title, count: item.count }))} /></PrintSection>
      <PrintSection title="ประเด็นที่ผู้บริหารควรติดตาม">{report.managementAttention.length ? <ol>{report.managementAttention.map((item) => <li key={item.title}><strong>{item.title} ({thaiNumber(item.count)})</strong><span>{item.description}</span></li>)}</ol> : <p>ไม่พบประเด็นสำคัญที่ต้องติดตามในช่วงเวลานี้</p>}</PrintSection>
      <footer>SMS-V3 Executive Report · หน้า 1</footer>
    </section>
  </article>;
}

function PrintSection({ title, children }: { title: string; children: ReactNode }) { return <section className="executive-report-print-section"><h2>{title}</h2>{children}</section>; }
function PrintList({ items }: { items: ReportItem[] }) { return items.length ? <ul>{items.slice(0, 6).map((item) => <li key={item.label}><span>{item.label}</span><b>{thaiNumber(item.count)}</b></li>)}</ul> : null; }

type ExecutiveReportCenterPageProps = {
  token: string;
  role: string;
  onNavigate(page: string): void;
  filters?: ExecutiveReportFilters;
  onFiltersChange?(filters: ExecutiveReportFilters): void;
  embedded?: boolean;
  includePrint?: boolean;
  onReportChange?(report?: ExecutiveReport): void;
};

export function ExecutiveReportCenterPage({ token, role, onNavigate, filters, onFiltersChange, embedded = false, includePrint = true, onReportChange }: ExecutiveReportCenterPageProps) {
  const bangkokParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
  const bangkokYear = Number(bangkokParts.find((part) => part.type === 'year')?.value);
  const bangkokMonth = Number(bangkokParts.find((part) => part.type === 'month')?.value);
  const [localYear, setLocalYear] = useState(bangkokYear);
  const [localMonth, setLocalMonth] = useState(bangkokMonth);
  const [localDepartment, setLocalDepartment] = useState('');
  const year = filters?.year ?? localYear;
  const month = filters?.month ?? localMonth;
  const department = filters?.department ?? localDepartment;
  const [report, setReport] = useState<ExecutiveReport>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const setFilter = (next: Partial<ExecutiveReportFilters>) => {
    if (filters && onFiltersChange) onFiltersChange({ ...filters, ...next });
    else {
      if (next.year !== undefined) setLocalYear(next.year);
      if (next.month !== undefined) setLocalMonth(next.month);
      if (next.department !== undefined) setLocalDepartment(next.department);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    api.executiveReport(token, { year, month, department: department || undefined })
      .then((response) => { if (active) { const next = response.data as ExecutiveReport; setReport(next); onReportChange?.(next); } })
      .catch(() => { if (active) setError('ไม่สามารถโหลดรายงานผู้บริหารได้ กรุณาลองใหม่อีกครั้ง'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, year, month, department, refresh, onReportChange]);

  const years = useMemo(() => Array.from({ length: 4 }, (_, index) => bangkokYear - index), [bangkokYear]);
  const departmentOptions = report?.scope.availableDepartments || [];
  const filename = report ? `SMS-V3-Executive-Report-${report.period.year}-${String(report.period.month).padStart(2, '0')}${department ? `-${department.replace(/[^a-zA-Z0-9_-]+/g, '-')}` : ''}.pdf` : 'SMS-V3-Executive-Report.pdf';

  return <section className="executive-report-page view-pane" aria-label="รายงานผู้บริหาร">
    {!embedded && <header className="executive-report-heading"><div><p className="eyebrow">EXECUTIVE REPORT CENTER</p><h1>รายงานผู้บริหาร</h1><p>สรุปข้อมูลสำคัญเพื่อการติดตามและบริหารงานรักษาความปลอดภัย</p></div><div className="executive-report-actions"><button type="button" className="btn-neutral" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>↻ รีเฟรช</button><button type="button" className="btn-primary" onClick={() => printDocument('.executive-report-print', filename)} disabled={!report || loading}>ส่งออก PDF</button></div></header>}
    {!embedded && <div className="executive-report-filters"><label><span>เดือน</span><select value={month} onChange={(event) => setFilter({ month: Number(event.target.value) })}>{monthNames.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></label><label><span>ปี</span><select value={year} onChange={(event) => setFilter({ year: Number(event.target.value) })}>{years.map((item) => <option key={item} value={item}>พ.ศ. {item + 543}</option>)}</select></label>{role === 'ADMIN' && <label><span>หน่วยงาน</span><select value={department} onChange={(event) => setFilter({ department: event.target.value })}><option value="">ทุกหน่วยงาน</option>{departmentOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}</div>}
    {loading && <div className="executive-report-loading" role="status">กำลังจัดทำรายงานผู้บริหาร…</div>}
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {report && !loading && <>
      <p className="executive-report-context">รอบรายงาน: <strong>{report.period.label}</strong> · ขอบเขต: <strong>{report.scope.departmentName}</strong> · สร้างเมื่อ {formatDateTime(report.generatedAt)}</p>
      <div className="executive-report-kpis">{report.executiveSummary.map((item) => <article className={`executive-report-kpi ${item.status}`} key={item.key}><span>{item.label}</span><strong>{thaiNumber(item.value)}</strong><small>{item.unit}</small></article>)}</div>
      <div className="executive-report-grid executive-report-grid-top"><section className="executive-report-panel"><header><h2>กำลังพลและการจัดเวร</h2><button type="button" className="executive-report-link" onClick={() => onNavigate('schedule')}>ดูรายละเอียด</button></header><div className="executive-report-stat-grid"><div><span>พนักงานทั้งหมด</span><b>{thaiNumber(report.workforce.totalEmployees)} คน</b></div><div><span>พนักงานที่ปฏิบัติงาน</span><b>{thaiNumber(report.workforce.activeEmployees)} คน</b></div><div><span>รายการจัดเวร</span><b>{thaiNumber(report.schedule.assignmentCount)} รายการ</b></div></div><Chart title="พนักงานที่ปฏิบัติงานตามหน่วยงาน" items={report.workforce.byDepartment} /><small className="executive-report-note">{report.schedule.periodNote}</small></section><section className="executive-report-panel"><header><h2>การลา</h2><button type="button" className="executive-report-link" onClick={() => onNavigate('leaveHistory')}>ดูรายละเอียด</button></header><div className="executive-report-statuses">{Object.entries(report.leave.statusCounts).map(([status, count]) => <div key={status}><span>{status}</span><b>{thaiNumber(count)}</b></div>)}</div><Chart title="คำขอลาตามประเภท" items={report.leave.byType} /><small className="executive-report-note">{report.leave.overlapRule}</small></section></div>
      <div className="executive-report-grid"><section className="executive-report-panel"><header><h2>สถานะใบอนุญาต</h2><button type="button" className="executive-report-link" onClick={() => onNavigate('licenses')}>ดูรายละเอียด</button></header><Chart title="การปฏิบัติตามใบอนุญาต" items={[{ label: 'หมดอายุ', count: report.license.expired }, { label: 'ใกล้หมดอายุ 30 วัน', count: report.license.expiringWithin30Days }, { label: 'ใช้งานได้เกิน 30 วัน', count: report.license.validBeyond30Days }, { label: 'รอตรวจสอบ', count: report.license.pendingReview }]} /></section><section className="executive-report-panel"><header><h2>คุณภาพข้อมูล</h2>{role === 'ADMIN' && <button type="button" className="executive-report-link" onClick={() => onNavigate('dataQuality')}>ดูรายละเอียด</button>}</header><div className="executive-report-statuses"><div><span>รวม</span><b>{thaiNumber(report.dataQuality.total)}</b></div><div><span>วิกฤต</span><b>{thaiNumber(report.dataQuality.critical)}</b></div><div><span>เตือน</span><b>{thaiNumber(report.dataQuality.warning)}</b></div></div><Chart title="ประเด็นตามกฎตรวจสอบ" items={report.dataQuality.categories.map((item) => ({ label: item.title, count: item.count }))} /></section></div>
      <section className="executive-report-panel executive-report-attention"><header><h2>ประเด็นที่ผู้บริหารควรติดตาม</h2></header>{report.managementAttention.length ? <div className="executive-report-attention-list">{report.managementAttention.map((item) => <article className={item.severity} key={item.title}><div><span>{item.severity}</span><h3>{item.title}</h3><p>{item.description}</p></div><b>{thaiNumber(item.count)}</b>{item.targetPath && <button type="button" className="executive-report-link" onClick={() => onNavigate(item.targetPath!)}>ดูรายละเอียด</button>}</article>)}</div> : <p className="executive-report-empty">ไม่พบประเด็นสำคัญที่ต้องติดตามในช่วงเวลานี้</p>}</section>
      {includePrint && <ExecutiveReportPrint report={report} />}
    </>}
  </section>;
}
