import type { CSSProperties } from 'react';
import { formatMetric, type DashboardNavigate } from './types';

type WorkforceOverviewCardProps = { totalEmployees: number; activeEmployees: number; workingToday: number; notScheduledToday: number; monthShifts: number; loading: boolean; onNavigate?: DashboardNavigate };

export function WorkforceOverviewCard({ totalEmployees, activeEmployees, workingToday, notScheduledToday, monthShifts, loading, onNavigate }: WorkforceOverviewCardProps) {
  const activePercent = totalEmployees ? Math.round((activeEmployees / totalEmployees) * 100) : 0;
  return <section className="dashboard-panel dashboard-workforce">
    <header className="dashboard-panel__header"><div><p>WORKFORCE OVERVIEW</p><h2>ภาพรวมกำลังพล</h2></div><span className="dashboard-period">ข้อมูลปัจจุบัน</span></header>
    {loading ? <div className="dashboard-panel__loading"><span className="dashboard-skeleton dashboard-skeleton--donut" /><span className="dashboard-skeleton dashboard-skeleton--lines" /></div> : totalEmployees === 0 ? <div className="dashboard-workforce__empty"><span className="dashboard-workforce__empty-icon">◌</span><strong>ยังไม่มีข้อมูลกำลังคน</strong><p>ระบบยังไม่พบข้อมูลบุคลากรที่สามารถนำมาสรุปได้</p>{onNavigate && <button type="button" onClick={() => onNavigate('employees')}>ไปที่ Personnel Directory</button>}</div> : <div className="dashboard-workforce__body">
      <div className="dashboard-donut" style={{ '--dashboard-progress': `${activePercent * 3.6}deg` } as CSSProperties} aria-label={`พนักงานที่ใช้งาน ${activeEmployees} จาก ${totalEmployees}`}><div><strong>{formatMetric(activeEmployees)}</strong><span>ใช้งาน</span></div></div>
      <div className="dashboard-legend"><div><span className="dashboard-legend__dot dashboard-legend__dot--indigo" /><p>พนักงาน active</p><b>{formatMetric(activeEmployees)}</b></div><div><span className="dashboard-legend__dot dashboard-legend__dot--green" /><p>มีกะวันนี้</p><b>{formatMetric(workingToday)}</b></div><div><span className="dashboard-legend__dot dashboard-legend__dot--warning" /><p>ยังไม่มีกะวันนี้</p><b>{formatMetric(notScheduledToday)}</b></div><div><span className="dashboard-legend__dot dashboard-legend__dot--teal" /><p>กะในเดือนนี้</p><b>{formatMetric(monthShifts)}</b></div></div>
    </div>}
    <p className="dashboard-panel__footnote">แสดงเฉพาะข้อมูลที่มีจาก Dashboard API</p>
  </section>;
}
