import { type DashboardActivity } from './types';

const entityLabels: Record<string, string> = { EmployeeLicenseDocument: 'ใบอนุญาต', EmployeeLicense: 'ใบอนุญาต', LeaveRequest: 'คำขอลา', ShiftAssignment: 'ตารางเวร', ScheduleApproval: 'การอนุมัติตารางเวร', User: 'บัญชีผู้ใช้', Employee: 'ข้อมูลพนักงาน' };
const actionLabels: Record<string, string> = { CREATE: 'สร้างรายการ', UPDATE: 'ปรับปรุงรายการ', DELETE: 'ลบรายการ', LEAVE_CREATED: 'ยื่นคำขอลา', LEAVE_APPROVED: 'อนุมัติคำขอลา', LEAVE_REJECTED: 'ไม่อนุมัติคำขอลา', LEAVE_CANCELLED: 'ยกเลิกคำขอลา', LICENSE_UPLOADED: 'อัปโหลดใบอนุญาต', LICENSE_APPROVED: 'อนุมัติใบอนุญาต', LICENSE_REJECTED: 'ไม่อนุมัติใบอนุญาต', SCHEDULE_UPDATED: 'ปรับปรุงตารางเวร' };
const technicalActions = new Set(['TOKEN_REUSE', 'REFRESH', 'REFRESHSESSION', 'REFRESH_SESSION', 'TOKEN_REFRESH', 'REFRESH_TOKEN']);

const normalizeAction = (value: unknown) => String(value || '').replace(/[\s-]/g, '_').toUpperCase();
export const isTechnicalActivity = (activity: DashboardActivity) => {
  const action = normalizeAction(activity.action);
  return technicalActions.has(action) || (action.includes('TOKEN') && action.includes('REFRESH')) || (action.includes('SESSION') && action.includes('REFRESH'));
};

export function RecentActivityCard({ activities = [] }: { activities?: DashboardActivity[] }) {
  const meaningfulActivities = activities.filter((activity) => !isTechnicalActivity(activity)).slice(0, 5);
  return <section className="dashboard-panel dashboard-recent-activity" aria-label="กิจกรรมธุรกิจล่าสุด">
    <header className="dashboard-panel__header"><div><p>RECENT ACTIVITY</p><h2>กิจกรรมสำคัญล่าสุด</h2></div><span className="dashboard-period">{meaningfulActivities.length ? meaningfulActivities.length + ' รายการ' : 'ไม่มีรายการ'}</span></header>
    {meaningfulActivities.length ? <div className="dashboard-activity-list dashboard-activity-list--compact">{meaningfulActivities.map((activity) => <div className="dashboard-activity-row" key={activity.id}><span className="dashboard-activity-dot" aria-hidden="true" /><div><b>{entityLabels[activity.entityType] || 'กิจกรรมธุรกิจ'} · {actionLabels[normalizeAction(activity.action)] || actionLabels[activity.action] || 'ดำเนินการ'}</b><small>{activity.actor?.displayName || 'ระบบ'} · {new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(activity.createdAt))}</small></div></div>)}</div> : <div className="dashboard-unavailable"><span aria-hidden="true">◌</span><div><b>ยังไม่มีข้อมูลกิจกรรมธุรกิจ</b><small>ซ่อนรายการ session และ token maintenance อัตโนมัติ</small></div></div>}
  </section>;
}
