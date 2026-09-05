import '../../styles/data-quality.css';
import '../../styles/data-quality-responsive.css';
import { DataTablePagination, DataTableSkeletonCards, DataTableSkeletonRows, DataTableState, ResponsiveDataTable } from '../../components/ResponsiveDataTable';

export type DataQualityFilters = {
  severity: string;
  module: string;
  rule: string;
  department: string;
  search: string;
};

export type DataQualityIssue = {
  id: string;
  rule: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO' | string;
  module: string;
  title: string;
  description: string;
  entityType: string;
  entityId: string;
  employeeCode?: string | null;
  employeeName?: string | null;
  department?: string | null;
  detectedValue?: string | null;
  targetPage?: 'licenses' | 'quota' | string;
};

type Summary = { total?: number; critical?: number; warning?: number; info?: number };
type Props = {
  rows: DataQualityIssue[];
  summary?: Summary;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  loading: boolean;
  error?: string;
  permissionDenied?: boolean;
  filters: DataQualityFilters;
  onFiltersChange(filters: DataQualityFilters): void;
  onRefresh(): void;
  onPageChange(page: number): void;
  onPageSize(value: number): void;
  onNavigate(page: 'licenses' | 'quota'): void;
};

const ruleLabels: Record<string, string> = {
  LEAVE_QUOTA_UNMATCHED: 'โควต้าวันลายังไม่จับคู่',
  LICENSE_EXPIRED: 'ใบอนุญาตหมดอายุ',
  LICENSE_EXPIRING_WITHIN_30_DAYS: 'ใบอนุญาตใกล้หมดอายุ ≤ 30 วัน',
  LICENSE_EXPIRING_31_TO_90_DAYS: 'ใบอนุญาตใกล้หมดอายุ 31–90 วัน'
};

const moduleLabels: Record<string, string> = { LEAVE_QUOTA: 'Leave Quota', LICENSE: 'License' };
const severityLabels: Record<string, string> = { CRITICAL: 'วิกฤต', WARNING: 'ควรติดตาม', INFO: 'ข้อมูล' };

function label(value: unknown, labels: Record<string, string> = {}) {
  const key = String(value ?? '');
  return labels[key] || key || '—';
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(parsed);
}

function severityClass(value: string) {
  return value === 'CRITICAL' ? 'critical' : value === 'WARNING' ? 'warning' : 'info';
}

function targetLabel(page?: string) {
  return page === 'quota' ? 'เปิดโควต้าวันลา' : page === 'licenses' ? 'เปิดใบอนุญาต' : '';
}

function FilterBar({ filters, onFiltersChange }: Pick<Props, 'filters' | 'onFiltersChange'>) {
  const update = (key: keyof DataQualityFilters, value: string) => onFiltersChange({ ...filters, [key]: value });
  return <div className="data-quality-filter-bar data-toolbar-panel data-toolbar data-toolbar--filters" aria-label="ตัวกรองคุณภาพข้อมูล">
    <label className={filters.severity ? 'is-filtered' : ''}><span>ระดับ</span><select value={filters.severity} onChange={(event) => update('severity', event.target.value)}><option value="">ทุกระดับ</option><option value="CRITICAL">วิกฤต</option><option value="WARNING">ควรติดตาม</option><option value="INFO">ข้อมูล</option></select></label>
    <label className={filters.module ? 'is-filtered' : ''}><span>Module</span><select value={filters.module} onChange={(event) => update('module', event.target.value)}><option value="">ทุก Module</option><option value="LICENSE">License</option><option value="LEAVE_QUOTA">Leave Quota</option></select></label>
    <label className={filters.rule ? 'is-filtered' : ''}><span>Rule</span><select value={filters.rule} onChange={(event) => update('rule', event.target.value)}><option value="">ทุกกฎ</option>{Object.entries(ruleLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
    <label className={filters.department ? 'is-filtered' : ''}><span>แผนก</span><input value={filters.department} maxLength={100} onChange={(event) => update('department', event.target.value)} placeholder="ทุกแผนก" /></label>
    <label className={`data-quality-search ${filters.search ? 'is-filtered' : ''}`}><span>ค้นหา</span><input value={filters.search} maxLength={100} onChange={(event) => update('search', event.target.value)} placeholder="ชื่อ, รหัสพนักงาน, เลขใบอนุญาต" /></label>
    <button type="button" className="btn-neutral small-action data-clear-filters" onClick={() => onFiltersChange({ severity: '', module: '', rule: '', department: '', search: '' })}>ล้างตัวกรอง</button>
  </div>;
}

function SeverityBadge({ value }: { value: string }) {
  return <span className={`data-quality-severity ${severityClass(value)}`}>{label(value, severityLabels)}</span>;
}

function TargetAction({ issue, onNavigate }: { issue: DataQualityIssue; onNavigate(page: 'licenses' | 'quota'): void }) {
  if (issue.targetPage !== 'licenses' && issue.targetPage !== 'quota') return <span className="data-quality-muted">—</span>;
  return <button type="button" className="data-quality-target" onClick={() => onNavigate(issue.targetPage as 'licenses' | 'quota')}>{targetLabel(issue.targetPage)}</button>;
}


export function DataQualityCenterPage({ rows, summary = {}, total, page, pageSize, totalPages, loading, error, permissionDenied, filters, onFiltersChange, onRefresh, onPageChange, onPageSize, onNavigate }: Props) {
  const cards = [
    ['critical', 'วิกฤต', summary.critical ?? 0],
    ['warning', 'ควรติดตาม', summary.warning ?? 0],
    ['info', 'ข้อมูล', summary.info ?? 0],
    ['total', 'ทั้งหมด', summary.total ?? total]
  ] as const;
  return <section className="data-quality-page data-surface-page" aria-label="ศูนย์ตรวจสอบคุณภาพข้อมูล">
    <header className="data-quality-header"><div><p className="data-quality-eyebrow">ADMIN · READ-ONLY</p><h1>ศูนย์ตรวจสอบคุณภาพข้อมูล</h1><p>ตรวจสอบความครบถ้วน ความสอดคล้อง และความผิดปกติของข้อมูลก่อนนำไปใช้งาน</p></div><div className="data-quality-header-actions"><span className="data-result-count">{total.toLocaleString('th-TH')} รายการ</span><button type="button" className="btn-neutral small-action" onClick={onRefresh} disabled={loading}>รีเฟรช</button></div></header>
    {permissionDenied ? <div className="data-quality-state data-state data-state--permission" role="alert"><strong>ไม่มีสิทธิ์เข้าถึงศูนย์คุณภาพข้อมูล</strong><p>เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูรายการนี้ได้</p></div> : error ? <div className="data-quality-state data-state data-state--error" role="alert"><strong>ไม่สามารถโหลดข้อมูลคุณภาพข้อมูล</strong><p>ระบบไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง</p><button type="button" className="btn-neutral small-action" onClick={onRefresh}>ลองใหม่</button></div> : <>
      <div className="data-quality-kpis">{cards.map(([tone, title, value]) => <article className={`data-quality-kpi ${tone}`} key={tone}><span aria-hidden="true">{tone === 'critical' ? '!' : tone === 'warning' ? '◒' : tone === 'info' ? 'i' : 'Σ'}</span><div><p>{title}</p><strong>{loading ? '—' : value.toLocaleString('th-TH')}</strong><small>รายการตามตัวกรอง</small></div></article>)}</div>
      <FilterBar filters={filters} onFiltersChange={onFiltersChange} />
      <div className="data-quality-page-size"><label htmlFor="data-quality-page-size">แสดงต่อหน้า</label><select id="data-quality-page-size" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></div>
      <ResponsiveDataTable
        ariaLabel="รายการคุณภาพข้อมูล"
        loading={loading}
        hasRows={rows.length > 0}
        className="data-quality-table-shell"
        desktop={<div className="data-quality-desktop-table"><div className="data-quality-table-scroll data-table-scroll"><table className="data-surface-table"><thead><tr><th scope="col">ระดับ</th><th scope="col">กฎตรวจสอบ</th><th scope="col">Module</th><th scope="col">พนักงาน</th><th scope="col">แผนก</th><th scope="col">ค่าที่ตรวจพบ</th><th scope="col">ไปยังข้อมูล</th></tr></thead><tbody>{loading ? <DataTableSkeletonRows columnCount={7} rowCount={5} /> : rows.length ? rows.map((issue) => <tr key={issue.id}><td><SeverityBadge value={issue.severity} /></td><td><strong>{label(issue.rule, ruleLabels)}</strong><small>{issue.description}</small></td><td>{label(issue.module, moduleLabels)}</td><td>{issue.employeeName || 'ไม่พบชื่อพนักงาน'}<small>{issue.employeeCode || '—'}</small></td><td>{issue.department || 'ไม่ระบุแผนก'}</td><td>{formatDate(issue.detectedValue)}</td><td><TargetAction issue={issue} onNavigate={onNavigate} /></td></tr>) : <tr><td colSpan={7} className="data-quality-empty data-table-empty-cell"><DataTableState variant="empty" announce={false} title={total ? 'ไม่พบรายการตามตัวกรองที่เลือก' : 'ไม่พบรายการคุณภาพข้อมูล'} description="ลองปรับตัวกรองเพื่อค้นหารายการเพิ่มเติม" /></td></tr>}</tbody></table></div></div>}
        mobile={<div className="data-quality-mobile-cards" aria-label="รายการคุณภาพข้อมูลสำหรับมือถือ">{loading ? <DataTableSkeletonCards count={3} cardClassName="data-quality-mobile-card data-mobile-card" /> : rows.length ? rows.map((issue) => <article className="data-quality-mobile-card data-mobile-card" key={issue.id}><header><SeverityBadge value={issue.severity} /><span>{label(issue.module, moduleLabels)}</span></header><h2>{label(issue.rule, ruleLabels)}</h2><p>{issue.description}</p><dl><div><dt>พนักงาน</dt><dd>{issue.employeeName || 'ไม่พบชื่อพนักงาน'}<small>{issue.employeeCode || '—'}</small></dd></div><div><dt>แผนก</dt><dd>{issue.department || 'ไม่ระบุแผนก'}</dd></div><div><dt>ค่าที่ตรวจพบ</dt><dd>{formatDate(issue.detectedValue)}</dd></div></dl><footer><TargetAction issue={issue} onNavigate={onNavigate} /></footer></article>) : <DataTableState variant="empty" title={total ? 'ไม่พบรายการตามตัวกรองที่เลือก' : 'ไม่พบรายการคุณภาพข้อมูล'} description="ลองปรับตัวกรองเพื่อค้นหารายการเพิ่มเติม" />}</div>}
      />
      <DataTablePagination page={page} totalPages={totalPages} onChange={onPageChange} ariaLabel="การแบ่งหน้ารายการคุณภาพข้อมูล" loading={loading} className="data-quality-pagination" />
    </>}
  </section>;
}
