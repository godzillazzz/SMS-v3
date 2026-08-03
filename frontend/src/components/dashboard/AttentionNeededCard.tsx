import { formatMetric, type DashboardAction, type DashboardNavigate } from './types';

type AttentionNeededCardProps = { rows: DashboardAction[]; loading: boolean; onNavigate: DashboardNavigate };

export function AttentionNeededCard({ rows, loading, onNavigate }: AttentionNeededCardProps) {
  return <section className="dashboard-panel dashboard-attention">
    <header className="dashboard-panel__header"><div><p>ATTENTION NEEDED</p><h2>รายการที่ต้องติดตาม</h2></div><span className={`dashboard-attention__count ${rows.length ? '' : 'is-clear'}`}>{rows.length ? `${rows.length} กลุ่มรายการ` : 'ปกติดี'}</span></header>
    {loading ? <div className="dashboard-list-skeleton"><span /><span /><span /></div> : rows.length ? <div className="dashboard-attention__list">{rows.map((row) => <button className="btn-ghost dashboard-attention-row" key={row.key} onClick={() => onNavigate(row.page)} aria-label={`${row.title} ${formatMetric(row.count)} รายการ`}><span className={`dashboard-attention-row__icon dashboard-attention-row__icon--${row.severity}`} aria-hidden="true">!</span><span><b>{row.title}</b><small>{row.severity === 'urgent' ? 'เร่งดำเนินการ' : row.severity === 'warning' ? 'ติดตามตามกำหนด' : 'ตรวจสอบต่อได้ทันที'}</small></span><em>{formatMetric(row.count)}</em><i aria-hidden="true">›</i></button>)}</div> : <div className="dashboard-empty-inline"><span>✓</span><div><b>ไม่มีรายการที่ต้องติดตาม</b><small>ระบบไม่พบเหตุการณ์หรือรายการสำคัญที่ต้องดำเนินการในขณะนี้</small></div></div>}
  </section>;
}
