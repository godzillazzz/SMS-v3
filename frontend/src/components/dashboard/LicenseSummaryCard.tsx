import { formatMetric, type DashboardNavigate } from './types';

type LicenseSummaryCardProps = { summary: Record<string, unknown>; overview: Record<string, unknown>; expiring: number; loading: boolean; onNavigate: DashboardNavigate };
const statuses = [
  ['APPROVED', 'ใช้งานได้', 'green'], ['PENDING', 'รอตรวจสอบ', 'warning'], ['RETURNED_FOR_CORRECTION', 'ส่งกลับแก้ไข', 'warning'],
  ['REJECTED', 'ไม่อนุมัติ', 'red'], ['EXPIRED', 'หมดอายุ', 'red'], ['SUPERSEDED', 'แทนที่แล้ว', 'muted']
] as const;

export function LicenseSummaryCard({ summary, overview, expiring, loading, onNavigate }: LicenseSummaryCardProps) {
  const total = statuses.reduce((sum, [status]) => sum + Number(summary[status] || 0), 0);
  const overviewRows = [
    ['valid', 'ใช้งานได้', 'green'],
    ['expiringWithin30', 'ใกล้หมดอายุ ≤ 30 วัน', 'warning'],
    ['expiringWithin90', 'ใกล้หมดอายุ 31–90 วัน', 'warning'],
    ['expired', 'หมดอายุ', 'red'],
    ['pendingReview', 'รอตรวจเอกสาร', 'warning']
  ] as const;
  const hasOverview = overviewRows.some(([key]) => Object.prototype.hasOwnProperty.call(overview, key));
  const overviewTotal = overviewRows.reduce((sum, [key]) => sum + Number(overview[key] || 0), 0);
  return <section className="dashboard-panel dashboard-license-summary" aria-label="สรุปสถานะใบอนุญาต">
    <header className="dashboard-panel__header"><div><p>LICENSE STATUS</p><h2>สรุปใบอนุญาต รปภ.</h2></div><button type="button" className="dashboard-link-button" onClick={() => onNavigate('licenses')}>ดูทั้งหมด →</button></header>
    {loading ? <div className="dashboard-list-skeleton"><span /><span /><span /></div> : (hasOverview ? overviewTotal : total) === 0 ? <div className="dashboard-empty-inline"><span>✓</span><div><b>ยังไม่มีข้อมูลใบอนุญาต</b><small>ระบบยังไม่มีเอกสารที่พร้อมสรุปสถานะ</small></div></div> : <div className="dashboard-status-bars">{(hasOverview ? overviewRows : statuses).map(([status, label, tone]) => { const value = Number((hasOverview ? overview : summary)[status] || 0); const basis = hasOverview ? overviewTotal : total; const width = basis ? `${Math.max(value ? 4 : 0, (value / basis) * 100)}%` : '0%'; return <button type="button" className="dashboard-status-row" key={status} onClick={() => onNavigate('licenses')} aria-label={`${label} ${formatMetric(value)} รายการ`}><span><b>{label}</b><small>{hasOverview ? 'current status' : status}</small></span><span className="dashboard-status-track"><i className={`dashboard-status-fill dashboard-status-fill--${tone}`} style={{ width }} /></span><strong>{formatMetric(value)}</strong></button>; })}</div>}
    <p className="dashboard-panel__footnote">ใกล้หมดอายุภายใน 30 วัน: <b>{formatMetric(expiring)}</b> รายการ</p>
  </section>;
}
