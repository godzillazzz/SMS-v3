import { formatMetric, type DashboardNavigate } from './types';

type LeaveSummaryCardProps = { summary: Record<string, unknown>; loading: boolean; canManage: boolean; canAdmin: boolean; onNavigate: DashboardNavigate };
export function LeaveSummaryCard({ summary, loading, canManage, canAdmin, onNavigate }: LeaveSummaryCardProps) {
  const rows = [['total', 'รวมเดือนนี้', 'leaveMonth', {}], ...(canManage ? [['PENDING', 'รออนุมัติ', 'leaveMonthStatus', { status: 'PENDING' }] as const] : []), ['APPROVED', 'อนุมัติแล้ว', 'leaveMonthStatus', { status: 'APPROVED' }], ['REJECTED', 'ไม่อนุมัติ', 'leaveMonthStatus', { status: 'REJECTED' }], ['CANCELLED', 'ยกเลิกแล้ว', 'leaveMonthStatus', { status: 'CANCELLED' }], ['today', 'ลาวันนี้', 'leaveToday', {}], ...(canAdmin ? [['unmatchedQuotas', 'โควต้ายังไม่จับคู่', 'unmatchedQuota', {}] as const] : [])] as const;
  return <section className="dashboard-panel dashboard-leave-summary" aria-label="สรุปการลา">
    <header className="dashboard-panel__header"><div><p>การลาและโควตา</p><h2>การลาและโควตาวันลา</h2></div><button type="button" className="dashboard-link-button" onClick={() => onNavigate('leaveHistory')}>ดูทั้งหมด</button></header>
    {loading ? <div className="dashboard-list-skeleton"><span /><span /><span /></div> : <div className="dashboard-mini-stat-grid">{rows.map(([key, label, metric, selector]) => { const value = Number(summary[key] || 0); return <button type="button" className="dashboard-mini-stat" key={key} onClick={() => onNavigate('dashboardDetails', { metric, ...selector })}><span>{label}</span><strong>{formatMetric(value)}</strong><small>{key === 'unmatchedQuotas' ? 'ต้องให้ผู้ดูแลระบบจับคู่' : 'ดูรายละเอียด'}</small></button>; })}</div>}
  </section>;
}
