import type { DashboardNavigate } from './types';
import { Button, Card } from '../ui/primitives';

type AttentionNeededCardProps = { expiringLicenses: number; pendingLeaves: number; pendingUsers: number; loading: boolean; onNavigate: DashboardNavigate };

export function AttentionNeededCard({ expiringLicenses, pendingLeaves, pendingUsers, loading, onNavigate }: AttentionNeededCardProps) {
  const rows = [
    { count: expiringLicenses, title: 'ใบอนุญาตใกล้หมดอายุ', detail: 'ตรวจสอบและต่ออายุใบอนุญาตก่อนจัดตารางกะ', tone: 'warning', page: 'licenses' as const },
    { count: pendingLeaves, title: 'คำขอลารออนุมัติ', detail: 'ตรวจสอบคำขอลาและผลกระทบต่อตารางกะ', tone: 'indigo', page: 'leavePending' as const },
    { count: pendingUsers, title: 'บัญชีผู้ใช้รอการจัดการ', detail: 'กำหนดสิทธิ์และเปิดใช้งานบัญชีตามนโยบาย', tone: 'teal', page: 'users' as const }
  ].filter((row) => row.count > 0);
  return <Card as="section" className="dashboard-panel dashboard-attention">
    <header className="dashboard-panel__header"><div><p>ATTENTION NEEDED</p><h2>รายการที่ต้องติดตาม</h2></div><span className={`dashboard-attention__count ${rows.length ? '' : 'is-clear'}`}>{rows.length ? `${rows.length} กลุ่มรายการ` : 'ปกติดี'}</span></header>
    {loading ? <div className="dashboard-list-skeleton" role="status" aria-label="กำลังโหลดรายการที่ต้องติดตาม"><span /><span /><span /></div> : rows.length ? <div className="dashboard-attention__list">{rows.map((row) => <Button variant="ghost" className="dashboard-attention-row" key={row.title} onClick={() => onNavigate(row.page)}><span className={`dashboard-attention-row__icon dashboard-attention-row__icon--${row.tone}`} aria-hidden="true">!</span><span><b>{row.title}</b><small>{row.detail}</small></span><em>{row.count}</em><i aria-hidden="true">›</i></Button>)}</div> : <div className="dashboard-empty-inline" role="status"><span aria-hidden="true">✓</span><div><b>ไม่มีรายการที่ต้องติดตาม</b><small>ระบบไม่พบเหตุการณ์หรือรายการสำคัญที่ต้องดำเนินการในขณะนี้</small></div></div>}
  </Card>;
}
