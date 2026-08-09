import { type DashboardActivity } from './types';

const entityLabels: Record<string, string> = { EmployeeLicenseDocument: 'ใบอนุญาต', EmployeeLicense: 'ใบอนุญาต', LeaveRequest: 'คำขอลา', ShiftAssignment: 'ตารางเวร', ScheduleApproval: 'การอนุมัติตารางเวร', User: 'บัญชีผู้ใช้', Employee: 'ข้อมูลพนักงาน' };
const actionLabels: Record<string, string> = { CREATE: 'สร้างรายการ', UPDATE: 'ปรับปรุงรายการ', DELETE: 'ลบรายการ' };

export function RecentActivityCard({ activities = [] }: { activities?: DashboardActivity[] }) {
  return <section className="dashboard-panel dashboard-recent-activity">
    <header className="dashboard-panel__header"><div><p>RECENT ACTIVITY</p><h2>กิจกรรมล่าสุด</h2></div><span className="dashboard-period">{activities.length ? `${activities.length} รายการ` : 'ไม่มีรายการ'}</span></header>
    {activities.length ? <div className="dashboard-activity-list">{activities.slice(0, 8).map((activity) => <div className="dashboard-activity-row" key={activity.id}><span className="dashboard-activity-dot" aria-hidden="true" /><div><b>{entityLabels[activity.entityType] || 'กิจกรรมระบบ'} · {actionLabels[activity.action] || 'ดำเนินการ'}</b><small>{activity.actor?.displayName || 'ระบบ'} · {new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(activity.createdAt))}</small></div></div>)}</div> : <div className="dashboard-unavailable"><span aria-hidden="true">◌</span><div><b>ยังไม่มีข้อมูลกิจกรรมล่าสุด</b><small>แสดงเฉพาะกิจกรรมทางธุรกิจตามสิทธิ์ที่ได้รับ</small></div></div>}
  </section>;
}
