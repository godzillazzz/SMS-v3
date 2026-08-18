import type { DashboardUser } from './types';

export function DashboardHeroHeader({ user }: { user?: DashboardUser }) {
  const scope = user?.role === 'ADMIN' ? 'ภาพรวมการปฏิบัติงานทุกหน่วยงานตามตัวกรองที่เลือก' : 'ภาพรวมการปฏิบัติงานและรายการสำคัญตามขอบเขตสิทธิ์ของคุณ';
  return <section className="dashboard-hero">
    <div>
      <div className="dashboard-hero__title-row"><h1>แดชบอร์ด</h1></div>
      <p className="dashboard-hero__subtitle">{scope}</p>
    </div>
  </section>;
}
