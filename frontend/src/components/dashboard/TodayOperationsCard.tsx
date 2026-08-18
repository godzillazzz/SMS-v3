import { formatMetric, type DashboardNavigate } from './types';

type ShiftGroup = { code?: string | null; name?: string; color?: string | null; count?: number };
type TodayOperationsCardProps = { operations: Record<string, unknown>; totalEmployees: number; activeEmployees: number; loading: boolean; onNavigate: DashboardNavigate };

const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function TodayOperationsCard({ operations, totalEmployees, activeEmployees, loading, onNavigate }: TodayOperationsCardProps) {
  const shifts = Array.isArray(operations.byShift) ? operations.byShift as ShiftGroup[] : [];
  const totalScheduled = numberValue(operations.totalScheduled);
  const onDuty = numberValue(operations.onDuty);
  const onLeave = numberValue(operations.onLeave);
  const noShift = numberValue(operations.noShift);
  const workforceTotal = activeEmployees || totalEmployees || totalScheduled;
  const stats = [
    ['totalScheduled', 'จัดกะวันนี้', 'schedule'],
    ['onDuty', 'พร้อมปฏิบัติงาน', 'schedule'],
    ['onLeave', 'ลาวันนี้', 'leave'],
    ['noShift', 'ไม่มีกะ', 'schedule']
  ] as const;
  return <section className="dashboard-panel dashboard-today-operations" aria-label="Today's Operations">
    <header className="dashboard-panel__header"><div><h2>กำลังพลวันนี้</h2><span>ภาพรวมกำลังพลตามวันที่เลือก</span></div><span className="dashboard-period">ข้อมูลตามวันที่เลือก</span></header>
    {loading ? <div className="dashboard-list-skeleton"><span /><span /><span /></div> : <>
      <div className="dashboard-today-highlight">
        <div><span>พร้อมปฏิบัติงาน</span><strong>{formatMetric(onDuty)} / {formatMetric(workforceTotal)}</strong><small>{formatMetric(totalScheduled)} คนมีตารางกะ · {formatMetric(onLeave)} คนลา</small></div>
        <span className={noShift ? 'dashboard-readiness-badge dashboard-readiness-badge--warning' : 'dashboard-readiness-badge'}>{noShift ? formatMetric(noShift) + ' ไม่มีกะ' : 'ครบทุกกะ'}</span>
      </div>
      <div className="dashboard-today-stats dashboard-today-stats--compact">{stats.map(([key, label, page]) => <button type="button" className="dashboard-today-stat" key={key} onClick={() => onNavigate(page)} aria-label={label + ' ' + formatMetric(numberValue(operations[key])) + ' คน'}><span>{label}</span><strong>{formatMetric(numberValue(operations[key]))}</strong></button>)}</div>
      <div className="dashboard-shift-groups" aria-label="กำลังพลแยกตามกะวันนี้"><div className="dashboard-subsection-heading"><b>กำลังพลตามกะ</b><small>{shifts.length ? formatMetric(shifts.length) + ' ประเภทกะ' : 'ยังไม่มีรายการกะ'}</small></div>{shifts.length ? shifts.map((shift) => <button type="button" className="dashboard-shift-group" key={String(shift.code || shift.name || 'shift')} onClick={() => onNavigate('schedule')}><span className="dashboard-shift-group__dot" style={shift.color ? { backgroundColor: shift.color } : undefined} /><span><b>{shift.name || shift.code || 'ไม่ระบุกะ'}</b><small>{shift.code || 'จากตารางวันนี้'}</small></span><strong>{formatMetric(numberValue(shift.count))}</strong><i aria-hidden="true">›</i></button>) : <div className="dashboard-empty-inline"><span>–</span><div><b>ไม่มีพนักงานในตารางวันนี้</b><small>ตรวจสอบตารางกะหรือช่วงวันที่ที่เลือก</small></div></div>}</div>
    </>}
  </section>;
}
