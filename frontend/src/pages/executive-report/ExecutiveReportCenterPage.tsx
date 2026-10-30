import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { RequestErrorContent, toRequestErrorState, type RequestErrorInput } from '../../request-error';
import { printDocument } from '../../schedule-print';
import { currentBangkokMonth, currentBangkokYear, formatThaiDate, formatThaiDateTime, formatThaiMonthName } from '../../thai-date-time';
import { SmsIcon, type SmsIconName } from '../../components/SmsIcon';
import '../../styles/executive-report.css';

type ReportItem = { label: string; count: number };
type Attention = { severity: string; title: string; description: string; count: number; targetPath?: string };
export type ExecutiveKpi = { key: string; label: string; value: number | null; unit: string; status: string; group?: 'operations' | 'action'; numerator?: number | null; denominator?: number | null; targetPath?: string | null; asOf?: string; unavailableLabel?: string; breakdown?: { expired: number; expiringWithin30Days: number } };
type PatrolDepartment = { department: string; checkpoints: number; expectedRounds: number; scannedRounds: number; missedRounds: number; coveragePercent: number | null };
export type ExecutiveReport = {
  period: { year: number; month: number; startDate: string; endDate: string; label: string };
  scope: { departmentName: string; allowsDepartmentFilter: boolean; availableDepartments: string[] };
  executiveSummary: ExecutiveKpi[];
  attendance?: { scheduledAssignments: number; checkedInAssignments: number; absentAssignments: number; assistOtherSiteCheckIns: number; attendanceRate: number | null };
  patrol?: { available: boolean; expectedRounds?: number; scannedRounds?: number; missedRounds?: number; coveragePercent?: number | null; byDepartment: PatrolDepartment[] };
  pendingQueue?: { available: boolean; total: number | null; asOf: string };
  dataQualityAvailability?: 'AVAILABLE' | 'PARTIAL_SCOPE';
  workforce: { totalEmployees: number; activeEmployees: number; byDepartment: ReportItem[] };
  schedule: { assignmentCount: number; periodNote: string };
  leave: { totalRequests: number; statusCounts: Record<string, number>; byType: ReportItem[]; overlapRule: string };
  license: { expired: number; expiringWithin30Days: number; validBeyond30Days: number; pendingReview: number; asOfDate: string };
  dataQuality: { total: number; critical: number; warning: number; info: number; categories: Array<ReportItem & { rule: string; severity: string; module: string; title: string }> };
  managementAttention: Attention[];
  generatedAt: string;
};

export type ExecutiveReportFilters = { year: number; month: number; department: string };
export const monthNames = Array.from({ length: 12 }, (_, index) => formatThaiMonthName(index + 1));
const leaveStatusLabel: Record<string, string> = { APPROVED: 'อนุมัติแล้ว', PENDING: 'รอพิจารณา', REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิก', RETURNED: 'ส่งกลับแก้ไข' };
const thaiNumber = (value: number) => new Intl.NumberFormat('th-TH').format(value);
// A KPI without a base (0/0) or outside the caller's scope arrives as null and is shown as "—", never 0.
export const kpiValueText = (item: Pick<ExecutiveKpi, 'value' | 'unit'>) => item.value === null || item.value === undefined ? '—' : item.unit === '%' ? `${new Intl.NumberFormat('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(item.value)}%` : thaiNumber(item.value);
const formatDateTime = (value: string) => formatThaiDateTime(value);

function Chart({ title, items }: { title: string; items: ReportItem[] }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return <section className="executive-report-chart" aria-label={title}><h3>{title}</h3>{items.length ? items.slice(0, 6).map((item) => <div className="executive-report-bar" key={item.label}><span>{item.label}</span><div><i style={{ width: `${Math.max(4, (item.count / max) * 100)}%` }} /></div><b>{thaiNumber(item.count)}</b></div>) : <p className="executive-report-empty">ไม่มีข้อมูลในช่วงที่เลือก</p>}</section>;
}

export function ExecutiveReportPrint({ report }: { report: ExecutiveReport }) {
  return <article className="print-only executive-report-print" aria-hidden="true">
    <section className="executive-report-print-page">
      <header><p>SECURITY MANAGEMENT SYSTEM</p><h1>รายงานผู้บริหาร</h1><span>{report.period.label} · {report.scope.departmentName}</span><small>สร้างรายงาน {formatDateTime(report.generatedAt)}</small></header>
      <div className="executive-report-print-kpis">{report.executiveSummary.map((item) => <div key={item.key}><span>{item.label}</span><strong>{kpiValueText(item)} {item.unit !== '%' && <small>{item.unit}</small>}</strong></div>)}</div>
      <PrintSection title="กำลังพลและการจัดเวร"><p>พนักงานทั้งหมด {thaiNumber(report.workforce.totalEmployees)} คน · พนักงานที่ปฏิบัติงาน {thaiNumber(report.workforce.activeEmployees)} คน · รายการจัดเวร {thaiNumber(report.schedule.assignmentCount)} รายการ</p><PrintList items={report.workforce.byDepartment} /></PrintSection>
      <PrintSection title="การลา"><p>คำขอลาที่ทับซ้อนกับช่วงเวลา {thaiNumber(report.leave.totalRequests)} รายการ · รอพิจารณา {thaiNumber(report.leave.statusCounts.PENDING || 0)} · อนุมัติ {thaiNumber(report.leave.statusCounts.APPROVED || 0)}</p><PrintList items={report.leave.byType} /></PrintSection>
      <PrintSection title="สถานะใบอนุญาต"><p>หมดอายุ {thaiNumber(report.license.expired)} · ใกล้หมดอายุภายใน 30 วัน {thaiNumber(report.license.expiringWithin30Days)} · ใช้งานได้เกิน 30 วัน {thaiNumber(report.license.validBeyond30Days)} · รอตรวจสอบ {thaiNumber(report.license.pendingReview)}</p></PrintSection>
      <PrintSection title="คุณภาพข้อมูล"><p>รวม {thaiNumber(report.dataQuality.total)} รายการ · วิกฤต {thaiNumber(report.dataQuality.critical)} · เตือน {thaiNumber(report.dataQuality.warning)} · ข้อมูล {thaiNumber(report.dataQuality.info)}</p><PrintList items={report.dataQuality.categories.map((item) => ({ label: item.title, count: item.count }))} /></PrintSection>
      <PrintSection title="ประเด็นที่ผู้บริหารควรติดตาม">{report.managementAttention.length ? <ol>{report.managementAttention.map((item) => <li key={item.title}><strong>{item.title} ({thaiNumber(item.count)})</strong><span>{item.description}</span></li>)}</ol> : <p>ไม่พบประเด็นสำคัญที่ต้องติดตามในช่วงเวลานี้</p>}</PrintSection>
      <footer>SMS Executive Report · หน้า 1</footer>
    </section>
  </article>;
}

function PrintSection({ title, children }: { title: string; children: ReactNode }) { return <section className="executive-report-print-section"><h2>{title}</h2>{children}</section>; }
function PrintList({ items }: { items: ReportItem[] }) { return items.length ? <ul>{items.slice(0, 6).map((item) => <li key={item.label}><span>{item.label}</span><b>{thaiNumber(item.count)}</b></li>)}</ul> : null; }


// KPI cards only link to pages the signed-in role can open (mirrors routing.ts canViewRoutePage).
const ROUTE_ROLES: Record<string, string[]> = {
  attendanceSupervisor: ['ADMIN', 'MANAGER', 'SUPERVISOR'],
  patrolCenter: ['ADMIN', 'MANAGER', 'SUPERVISOR'],
  licenses: ['ADMIN', 'MANAGER', 'SUPERVISOR'],
  leavePending: ['ADMIN', 'MANAGER', 'SUPERVISOR'],
  approvalCenter: ['ADMIN', 'MANAGER', 'SUPERVISOR'],
  dataQuality: ['ADMIN'],
  leaveHistory: ['ADMIN', 'MANAGER', 'SUPERVISOR']
};
export function kpiTarget(targetPath: string | null | undefined, role: string): string | null {
  if (!targetPath) return null;
  return ROUTE_ROLES[targetPath]?.includes(role) ? targetPath : null;
}

const KPI_ICON: Record<string, SmsIconName> = { attendanceRate: 'clock', absentAssignments: 'attendance', patrolCoverage: 'location', assistOtherSite: 'shield', licenseAttention: 'license', pendingLeave: 'leave', pendingQueue: 'approval', criticalDataQuality: 'quality' };

function kpiDetail(item: ExecutiveKpi): string {
  if (item.unavailableLabel && item.value === null) return item.unavailableLabel;
  switch (item.key) {
    case 'attendanceRate': return item.denominator ? `${thaiNumber(item.numerator || 0)} / ${thaiNumber(item.denominator)} กะ · เช็กอินจริง ÷ กะที่จัด` : 'ยังไม่มีกะที่ถึงเวลาในช่วงนี้';
    case 'absentAssignments': return 'กะที่สิ้นสุดแล้ว ไม่รวม OFF และลาที่อนุมัติ';
    case 'patrolCoverage': return item.denominator ? `${thaiNumber(item.numerator || 0)} / ${thaiNumber(item.denominator)} รอบ · จุดตรวจ × รอบที่สิ้นสุดแล้ว` : 'ยังไม่มีรอบตรวจที่สิ้นสุดในช่วงนี้';
    case 'assistOtherSite': return 'เช็กอิน Support-Site ที่ไม่ซ้ำ';
    case 'licenseAttention': return `หมดอายุ ${thaiNumber(item.breakdown?.expired || 0)} · ใกล้หมดอายุ ${thaiNumber(item.breakdown?.expiringWithin30Days || 0)}`;
    case 'pendingLeave': return 'ช่วงวันลาทับซ้อนกับเดือนที่เลือก';
    case 'pendingQueue': return 'ณ ปัจจุบัน · คิวที่คุณดำเนินการได้';
    case 'criticalDataQuality': return item.unavailableLabel ? `บางกฎ${item.unavailableLabel}` : 'ต้องตรวจสอบและแก้ไข';
    default: return '';
  }
}

function KpiCard({ item, role, onNavigate }: { item: ExecutiveKpi; role: string; onNavigate(page: string): void }) {
  const target = kpiTarget(item.targetPath, role);
  const body = <>
    <span className="executive-kpi-head"><i aria-hidden="true"><SmsIcon name={KPI_ICON[item.key] || 'report'} size={16} /></i><span className="executive-kpi-title">{item.label}</span>{target && <b className="executive-kpi-arrow" aria-hidden="true">↗</b>}</span>
    <span className="executive-kpi-value"><strong>{kpiValueText(item)}</strong>{item.value !== null && item.unit !== '%' && <small>{item.unit}</small>}</span>
    <span className="executive-kpi-detail">{kpiDetail(item)}</span>
  </>;
  const className = `executive-report-kpi executive-kpi ${item.status}${item.value === null ? ' is-empty' : ''}`;
  return target
    ? <button type="button" className={className} data-kpi={item.key} onClick={() => onNavigate(target)} aria-label={`${item.label} ${kpiValueText(item)} — เปิดรายละเอียด`}>{body}</button>
    : <article className={className} data-kpi={item.key}>{body}</article>;
}

function PatrolDepartmentChart({ patrol }: { patrol: ExecutiveReport['patrol'] }) {
  const rows = patrol?.byDepartment || [];
  return <section className="executive-report-panel executive-patrol-chart" aria-labelledby="executive-patrol-title">
    <header><h2 id="executive-patrol-title">ความครบถ้วนการตรวจจุดรายจุดปฏิบัติงาน</h2><small>รอบที่มีสแกน ÷ รอบที่กำหนด</small></header>
    {!patrol?.available ? <p className="executive-report-empty">ข้อมูลการตรวจจุดเกินขีดจำกัดของรายงาน โปรดดูที่ศูนย์ตรวจจุด</p>
      : rows.length ? rows.map((row) => <div className={`executive-report-bar executive-patrol-bar${row.coveragePercent !== null && row.coveragePercent < 90 ? ' is-low' : ''}`} key={row.department}><span>{row.department}</span><div><i style={{ width: `${row.coveragePercent === null ? 0 : Math.max(2, row.coveragePercent)}%` }} /></div><b>{row.coveragePercent === null ? '—' : `${row.coveragePercent.toFixed(1)}%`}</b></div>)
        : <p className="executive-report-empty">ไม่มีจุดตรวจที่เปิดใช้งานในขอบเขตนี้</p>}
    <small className="executive-report-note">8 รอบต่อวัน (07:00 ถึง 07:00 วันถัดไป) · คิดเป็นจุดตรวจ × รอบที่สิ้นสุดแล้ว · ใช้รายการจุดตรวจที่เปิดใช้งานปัจจุบัน</small>
  </section>;
}

type ExecutiveReportCenterPageProps = {
  token: string;
  role: string;
  onNavigate(page: string): void;
  filters?: ExecutiveReportFilters;
  onFiltersChange?(filters: ExecutiveReportFilters): void;
  embedded?: boolean;
  includePrint?: boolean;
  onReportChange?(report?: ExecutiveReport): void;
  fetchEnabled?: boolean;
  refreshSignal?: number;
};

export function ExecutiveReportCenterPage({ token, role, onNavigate, filters, onFiltersChange, embedded = false, includePrint = true, onReportChange, fetchEnabled = true, refreshSignal = 0 }: ExecutiveReportCenterPageProps) {
  const bangkokYear = currentBangkokYear();
  const bangkokMonth = Number(currentBangkokMonth().slice(5, 7));
  const [localYear, setLocalYear] = useState(bangkokYear);
  const [localMonth, setLocalMonth] = useState(bangkokMonth);
  const [localDepartment, setLocalDepartment] = useState('');
  const year = filters?.year ?? localYear;
  const month = filters?.month ?? localMonth;
  const department = filters?.department ?? localDepartment;
  const [report, setReport] = useState<ExecutiveReport>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RequestErrorInput>();
  const [refresh, setRefresh] = useState(0);
  const [loadedKey, setLoadedKey] = useState('');
  const reportKey = `${year}:${month}:${department}`;
  const requestKey = `${reportKey}:${refresh}`;
  const setFilter = (next: Partial<ExecutiveReportFilters>) => {
    if (filters && onFiltersChange) onFiltersChange({ ...filters, ...next });
    else {
      if (next.year !== undefined) setLocalYear(next.year);
      if (next.month !== undefined) setLocalMonth(next.month);
      if (next.department !== undefined) setLocalDepartment(next.department);
    }
  };

  useEffect(() => {
    setLoadedKey('');
    setReport(undefined);
    onReportChange?.(undefined);
  }, [token, onReportChange]);

  useEffect(() => {
    if (!refreshSignal) return;
    setLoadedKey('');
    setRefresh((value) => value + 1);
  }, [refreshSignal]);

  useEffect(() => {
    if (!fetchEnabled || loadedKey === requestKey) { setLoading(false); return; }
    let active = true;
    setLoading(true); setError(undefined);
    api.executiveReport(token, { year, month, department: department || undefined })
      .then((response) => { if (active) { const next = response.data as ExecutiveReport; setReport(next); setLoadedKey(requestKey); onReportChange?.(next); } })
      .catch((reason) => { if (active) setError(toRequestErrorState(reason, 'ไม่สามารถโหลดรายงานผู้บริหารได้ กรุณาลองใหม่อีกครั้ง')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, year, month, department, refresh, onReportChange, fetchEnabled, loadedKey, requestKey]);

  const years = useMemo(() => Array.from({ length: 4 }, (_, index) => bangkokYear - index), [bangkokYear]);
  const departmentOptions = report?.scope.availableDepartments || [];
  const filename = report ? `SMS-Executive-Report-${report.period.year}-${String(report.period.month).padStart(2, '0')}${department ? `-${department.replace(/[^a-zA-Z0-9_-]+/g, '-')}` : ''}.pdf` : 'SMS-Executive-Report.pdf';

  return <section className="executive-report-page view-pane nexus-executive-intelligence" aria-label="Executive Security Intelligence">
    <div className="nexus-page-breadcrumb">รายงานผู้บริหาร</div>
    {!embedded && <header className="executive-report-heading"><div><p className="eyebrow">EXECUTIVE REPORT CENTER</p><h1>รายงานผู้บริหาร</h1><p>สรุปข้อมูลสำคัญเพื่อการติดตามและบริหารงานรักษาความปลอดภัย</p></div><div className="executive-report-actions"><button type="button" className="btn-neutral" onClick={() => { setLoadedKey(''); setRefresh((value) => value + 1); }} disabled={loading}>↻ รีเฟรช</button><button type="button" className="btn-primary" onClick={() => void printDocument('.executive-report-print', filename, { orientation: 'landscape', margin: '12mm' })} disabled={!report || loading}>ส่งออก PDF</button></div></header>}
    {!embedded && <div className="executive-report-filters"><label><span>เดือน</span><select value={month} onChange={(event) => setFilter({ month: Number(event.target.value) })}>{monthNames.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></label><label><span>ปี</span><select value={year} onChange={(event) => setFilter({ year: Number(event.target.value) })}>{years.map((item) => <option key={item} value={item}>พ.ศ. {item + 543}</option>)}</select></label>{(report?.scope.allowsDepartmentFilter ?? ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(role)) && <label><span>จุดปฏิบัติงาน</span><select value={department} onChange={(event) => setFilter({ department: event.target.value })}><option value="">ทุกจุดปฏิบัติงาน</option>{departmentOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}</div>}
    {loading && <div className="executive-report-loading" role="status">กำลังจัดทำรายงานผู้บริหาร…</div>}
    {error && <div className="alert alert-error" role="alert"><RequestErrorContent error={error} /></div>}
    {report && !loading && <>
      <p className="executive-report-context"><span aria-hidden="true">ⓘ</span> รอบรายงาน: <strong>{report.period.label}</strong> · ขอบเขต: <strong>{report.scope.departmentName}</strong> · พนักงานที่ปฏิบัติงาน <strong>{thaiNumber(report.workforce.activeEmployees)} คน</strong> · จุดปฏิบัติงาน <strong>{thaiNumber(report.scope.allowsDepartmentFilter && !department ? report.workforce.byDepartment.length : 1)} จุดปฏิบัติงาน</strong> · ข้อมูล ณ {formatDateTime(report.generatedAt)}</p>
      {(['operations', 'action'] as const).map((group) => <section className={`executive-kpi-group executive-kpi-group--${group}`} key={group} aria-labelledby={`executive-kpi-${group}`}>
        <h2 id={`executive-kpi-${group}`} className="executive-kpi-group__title"><i aria-hidden="true">{group === 'operations' ? '◉' : '!'}</i>{group === 'operations' ? 'งานปฏิบัติการ' : 'ต้องจัดการ'}</h2>
        <div className="executive-report-kpis executive-kpi-row">{report.executiveSummary.filter((item) => (item.group || 'operations') === group).map((item) => <KpiCard key={item.key} item={item} role={role} onNavigate={onNavigate} />)}</div>
      </section>)}
      <div className="executive-report-grid executive-report-grid-top">
        <PatrolDepartmentChart patrol={report.patrol} />
        <section className="executive-report-panel executive-leave-license"><header><h2>การลาและใบอนุญาต</h2><button type="button" className="executive-report-link" onClick={() => onNavigate('leaveHistory')}>ดูรายละเอียด ↗</button></header>
          <div className="executive-leave-license__charts"><Chart title="คำขอลาตามประเภท · รายการ" items={report.leave.byType} /><Chart title="สถานะใบอนุญาต · รายการ" items={[{ label: 'ใช้ได้', count: report.license.validBeyond30Days }, { label: 'ใกล้หมด', count: report.license.expiringWithin30Days }, { label: 'หมดอายุ', count: report.license.expired }]} /></div>
          <small className="executive-report-note">{report.leave.overlapRule} · สถานะใบอนุญาต ณ {formatThaiDate(`${report.license.asOfDate}T00:00:00+07:00`, { day: 'numeric', month: 'short', year: 'numeric' })}</small>
        </section>
      </div>
      <section className="executive-report-panel executive-report-attention"><header><h2>ประเด็นที่ผู้บริหารควรติดตาม</h2><small>รายการที่ต้องเร่งติดตามในรอบรายงาน</small></header>{report.managementAttention.length ? <div className="executive-report-attention-list">{report.managementAttention.map((item) => { const target = kpiTarget(item.targetPath, role); return <article className={item.severity} key={item.title}><div><h3>{item.title}</h3><p>{item.description}</p></div><b>{thaiNumber(item.count)}</b>{target && <button type="button" className="executive-report-link" onClick={() => onNavigate(target)}>ดูรายละเอียด</button>}</article>; })}</div> : <p className="executive-report-empty">ไม่พบประเด็นสำคัญที่ต้องติดตามในช่วงเวลานี้</p>}</section>
      {includePrint && <ExecutiveReportPrint report={report} />}
    </>}
  </section>;
}
