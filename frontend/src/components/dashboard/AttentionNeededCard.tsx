import type { DashboardNavigate } from './types';

type AttentionNeededCardProps = { expiringLicenses: number; pendingLeaves: number; pendingUsers: number; loading: boolean; onNavigate: DashboardNavigate };

export function AttentionNeededCard({ expiringLicenses, pendingLeaves, pendingUsers, loading, onNavigate }: AttentionNeededCardProps) {
  const rows = [
    { count: expiringLicenses, title: 'ใบอนุญาตใกล้หมดอายุ', detail: 'ตรวจสอบและต่ออายุใบอนุญาตก่อนจัดตารางกะ', tone: 'warning', page: 'licenses' as const },
    { count: pendingLeaves, title: 'คำขอลารออนุมัติ', detail: 'ตรวจสอบคำขอลาและผลกระทบต่อตารางกะ', tone: 'indigo', page: 'leavePending' as const },
    { count: pendingUsers, title: 'บัญชีผู้ใช้รอการจัดการ', detail: 'กำหนดสิทธิ์และเปิดใช้งานบัญชีตามนโยบาย', tone: 'teal', page: 'users' as const }
  ].filter((row) => row.count > 0);
  return <section className="dashboard-panel dashboard-attention">
    <header className="dashboard-panel__header"><div><p>ATTENTION NEEDED</p><h2>รายการที่ต้องติดตาม</h2></div><span className={`dashboard-attention__count ${rows.length ? '' : 'is-clear'}`}>{rows.length ? `${rows.length} กลุ่มรายการ` : 'ปกติดี'}</span></header>
    {loading ? <div className="dashboard-list-skeleton"><span /><span /><span /></div> : rows.length ? <div className="dashboard-attention__list">{rows.map((row) => <button className="dashboard-attention-row" key={row.title} onClick={() => onNavigate(row.page)}><span className={`dashboard-attention-row__icon dashboard-attention-row__icon--${row.tone}`} aria-hidden="true">!</span><span><b>{row.title}</b><small>{row.detail}</small></span><em>{row.count}</em><i aria-hidden="true">›</i></button>)}</div> : <div className="dashboard-empty-inline"><span>✓</span><div><b>ไม่มีรายการที่ต้องติดตาม</b><small>ระบบไม่พบเหตุการณ์หรือรายการสำคัญที่ต้องดำเนินการในขณะนี้</small></div></div>}
  </section>;
}
