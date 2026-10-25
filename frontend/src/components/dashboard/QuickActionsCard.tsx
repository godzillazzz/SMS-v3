import type { DashboardNavigate } from './types';
import { Button } from '../ui/primitives';

type QuickActionsCardProps = { canManage: boolean; onNavigate: DashboardNavigate };
export function QuickActionsCard({ canManage, onNavigate }: QuickActionsCardProps) {
  const actions = [
    { icon: '⌕', title: 'ค้นหาพนักงาน', detail: 'ค้นหาและตรวจสอบข้อมูลบุคลากร', page: 'employees' as const },
    { icon: '▤', title: 'ตารางกะรายเดือน', detail: 'ตรวจสอบและจัดการตารางกะ', page: 'schedule' as const },
    ...(canManage ? [
      { icon: '▥', title: 'คำขอรออนุมัติ', detail: 'ตรวจสอบรายการของทีมงาน', page: 'leavePending' as const },
      { icon: '◈', title: 'ใบอนุญาตพนักงาน', detail: 'ติดตามสถานะใบอนุญาต', page: 'licenses' as const }
    ] : [])
  ];
  return <div className="dashboard-quick-actions__grid">{actions.map((action) => <Button variant="ghost" key={action.title} onClick={() => onNavigate(action.page)}><span aria-hidden="true">{action.icon}</span><b>{action.title}</b><small>{action.detail}</small></Button>)}</div>;
}
