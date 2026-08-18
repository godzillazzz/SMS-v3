import { SmsIcon } from '../SmsIcon';
import type { DashboardFilters } from './types';

type DashboardFilterBarProps = {
  filters: DashboardFilters;
  departments: string[];
  role?: string;
  loading: boolean;
  onChange: (filters: Partial<DashboardFilters>) => void;
};

export function DashboardFilterBar({ filters, departments, role, loading, onChange }: DashboardFilterBarProps) {
  const canChooseDepartment = role === 'ADMIN';
  return <section className="dashboard-filter-bar" aria-label="ตัวกรอง Dashboard">
    <span className="dashboard-filter-bar__icon" aria-hidden="true"><SmsIcon name="calendar" size={17} /></span>
    <div className="dashboard-filter-bar__controls">
      <label><span>วันที่</span><input type="date" value={filters.date} onChange={(event) => onChange({ date: event.target.value, month: event.target.value.slice(0, 7) })} disabled={loading} /></label>
      <label><span>เดือน</span><input type="month" value={filters.month} onChange={(event) => onChange({ month: event.target.value })} disabled={loading} /></label>
      {canChooseDepartment && <label><span>หน่วยงาน</span><select value={filters.department} onChange={(event) => onChange({ department: event.target.value })} disabled={loading}><option value="">ทุกหน่วยงาน</option>{departments.map((department) => <option value={department} key={department}>{department}</option>)}</select></label>}
    </div>
  </section>;
}
