import { type DashboardActivity } from './types';

export function RecentActivityCard({ activities = [] }: { activities?: DashboardActivity[] }) {
  return <section className="dashboard-panel dashboard-recent-activity">
    <header className="dashboard-panel__header"><div><p>RECENT ACTIVITY</p><h2>กิจกรรมล่าสุด</h2></div><span className="dashboard-period">{activities.length ? `${activities.length} รายการ` : 'ไม่มีรายการ'}</span></header>
    {activities.length ? <div className="dashboard-activity-list">{activities.slice(0, 8).map((activity) => <div className="dashboard-activity-row" key={activity.id}><span className="dashboard-activity-dot" aria-hidden="true" /><div><b>{activity.entityType} · {activity.action}</b><small>{activity.actor?.displayName || 'ระบบ'} · {new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(activity.createdAt))}</small></div></div>)}</div> : <div className="dashboard-unavailable"><span aria-hidden="true">◌</span><div><b>ยังไม่มีข้อมูลกิจกรรมล่าสุด</b><small>จะแสดงเมื่อมีข้อมูล activity ที่ผู้ใช้มีสิทธิ์เห็น</small></div></div>}
  </section>;
}
