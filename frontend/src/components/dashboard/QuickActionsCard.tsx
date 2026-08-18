import { SmsIcon, type SmsIconName } from '../SmsIcon';
import type { DashboardNavigate, DashboardPage } from './types';

type QuickActionsCardProps = { canManage: boolean; onNavigate: DashboardNavigate };
type QuickAction = { icon: SmsIconName; title: string; detail: string; page: DashboardPage };

export function QuickActionsCard({ canManage, onNavigate }: QuickActionsCardProps) {
  const actions: QuickAction[] = [
    { icon: 'employees', title: 'ข้อมูลพนักงาน', detail: 'ค้นหาและตรวจสอบข้อมูลบุคลากร', page: 'employees' },
    { icon: 'calendar', title: 'ตารางกะรายเดือน', detail: 'ดูและจัดการตารางกะตามสิทธิ์', page: 'schedule' },
    ...(canManage ? [
      { icon: 'approval' as SmsIconName, title: 'รออนุมัติ', detail: 'ตรวจสอบคำขอลาที่รอการพิจารณา', page: 'leavePending' as DashboardPage },
      { icon: 'license' as SmsIconName, title: 'ใบอนุญาต รปภ.', detail: 'ติดตามสถานะและเอกสารใบอนุญาต', page: 'licenses' as DashboardPage }
    ] : [])
  ];
  return <section className="dashboard-panel dashboard-quick-actions">
    <header className="dashboard-panel__header"><div><h2>ทางลัดการทำงาน</h2><span>เปิดโมดูลที่ใช้งานบ่อยจากข้อมูลและสิทธิ์ปัจจุบัน</span></div></header>
    <div className="dashboard-quick-actions__grid">{actions.map((action) => <button className="btn-ghost" key={action.title} onClick={() => onNavigate(action.page)}><span><SmsIcon name={action.icon} size={20} /></span><b>{action.title}</b><small>{action.detail}</small><i aria-hidden="true">›</i></button>)}</div>
  </section>;
}
