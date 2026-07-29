import type { DashboardNavigate } from './types';

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
  return <section className="dashboard-panel dashboard-quick-actions">
    <header className="dashboard-panel__header"><div><p>QUICK ACTIONS</p><h2>ทางลัดการทำงาน</h2></div></header>
    <div className="dashboard-quick-actions__grid">{actions.map((action) => <button key={action.title} onClick={() => onNavigate(action.page)}><span>{action.icon}</span><b>{action.title}</b><small>{action.detail}</small></button>)}</div>
  </section>;
}
