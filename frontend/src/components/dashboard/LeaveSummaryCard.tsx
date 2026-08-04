import { formatMetric, type DashboardNavigate } from './types';

type LeaveSummaryCardProps = { summary: Record<string, unknown>; loading: boolean; canManage: boolean; canAdmin: boolean; onNavigate: DashboardNavigate };
export function LeaveSummaryCard({ summary, loading, canManage, canAdmin, onNavigate }: LeaveSummaryCardProps) {
  const rows = [['today', 'ลาวันนี้', 'leave'], ['month', 'ลาเดือนนี้', 'leaveHistory'], ...(canManage ? [['pending', 'รออนุมัติ', 'leavePending'] as const] : []), ...(canAdmin ? [['unmatchedQuotas', 'โควต้ายังไม่จับคู่', 'quota'] as const] : [])] as const;
  return <section className="dashboard-panel dashboard-leave-summary" aria-label="สรุปการลา">
    <header className="dashboard-panel__header"><div><p>LEAVE & QUOTA</p><h2>การลาและโควตาวันลา</h2></div></header>
    {loading ? <div className="dashboard-list-skeleton"><span /><span /><span /></div> : <div className="dashboard-mini-stat-grid">{rows.map(([key, label, page]) => <button type="button" className="dashboard-mini-stat" key={key} onClick={() => onNavigate(page)} aria-label={`${label} ${formatMetric(Number(summary[key] || 0))} รายการ`}><span>{label}</span><strong>{formatMetric(Number(summary[key] || 0))}</strong><small>{key === 'unmatchedQuotas' ? 'ต้องให้ Admin จับคู่' : 'ดูรายละเอียด'}</small></button>)}</div>}
  </section>;
}
