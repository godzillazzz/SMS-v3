import { formatMetric, type DashboardNavigate } from './types';

type ShiftGroup = { code?: string | null; name?: string; color?: string | null; count?: number };
type TodayOperationsCardProps = { operations: Record<string, unknown>; loading: boolean; onNavigate: DashboardNavigate };

const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function TodayOperationsCard({ operations, loading, onNavigate }: TodayOperationsCardProps) {
  const shifts = Array.isArray(operations.byShift) ? operations.byShift as ShiftGroup[] : [];
  const stats = [
    ['totalScheduled', 'จัดกะวันนี้', 'schedule'],
    ['onDuty', 'กำลังปฏิบัติงาน', 'schedule'],
    ['onLeave', 'ลาวันนี้', 'leave'],
    ['noShift', 'ยังไม่มีกะ', 'schedule']
  ] as const;
  return <section className="dashboard-panel dashboard-today-operations" aria-label="Today's Operations">
    <header className="dashboard-panel__header"><div><p>TODAY'S OPERATIONS</p><h2>ปฏิบัติการวันนี้</h2></div><span className="dashboard-period">ตามตารางกะ</span></header>
    {loading ? <div className="dashboard-list-skeleton"><span /><span /><span /></div> : <>
      <div className="dashboard-today-stats">{stats.map(([key, label, page]) => <button type="button" className="dashboard-today-stat" key={key} onClick={() => onNavigate(page)}><span>{label}</span><strong>{formatMetric(numberValue(operations[key]))}</strong></button>)}</div>
      <div className="dashboard-shift-groups" aria-label="กำลังพลแยกตามกะวันนี้"><div className="dashboard-subsection-heading"><b>กำลังพลตามกะ</b><small>{shifts.length ? `${formatMetric(shifts.length)} ประเภทกะ` : 'ยังไม่มีรายการกะ'}</small></div>{shifts.length ? shifts.map((shift) => <button type="button" className="dashboard-shift-group" key={`${shift.code || shift.name}`} onClick={() => onNavigate('schedule')}><span className="dashboard-shift-group__dot" style={shift.color ? { backgroundColor: shift.color } : undefined} /><span><b>{shift.name || shift.code || 'ไม่ระบุกะ'}</b><small>{shift.code || 'จากตารางวันนี้'}</small></span><strong>{formatMetric(numberValue(shift.count))}</strong><i aria-hidden="true">›</i></button>) : <div className="dashboard-empty-inline"><span>–</span><div><b>ไม่มีพนักงานในตารางวันนี้</b><small>ตรวจสอบตารางกะหรือช่วงวันที่ที่เลือก</small></div></div>}</div>
    </>}
  </section>;
}
