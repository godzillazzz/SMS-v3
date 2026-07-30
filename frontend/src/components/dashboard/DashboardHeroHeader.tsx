import type { DashboardUser } from './types';

export function DashboardHeroHeader({ user }: { user?: DashboardUser }) {
  const role = user?.role || 'VIEWER';
  return <section className="dashboard-hero">
    <div>
      <p className="dashboard-hero__eyebrow">SMS v3 · OPERATIONS CENTER</p>
      <div className="dashboard-hero__title-row"><h1>Executive Operations Dashboard</h1><span className="dashboard-hero__status dashboard-hero__status--inline"><span className="dashboard-status-dot" aria-hidden="true" />Operational workspace</span></div>
      <p className="dashboard-hero__subtitle">ภาพรวมการปฏิบัติงาน บุคลากร และรายการที่ต้องติดตามในระบบ · สิทธิ์ปัจจุบัน: {role}</p>
    </div>
  </section>;
}
