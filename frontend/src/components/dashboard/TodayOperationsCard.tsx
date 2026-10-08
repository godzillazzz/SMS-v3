import { formatMetric, type DashboardNavigate } from './types';

type ShiftGroup = { code?: string | null; name?: string; color?: string | null; count?: number };
type TodayOperationsCardProps = { operations: Record<string, unknown>; loading: boolean; onNavigate: DashboardNavigate };

const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function TodayOperationsCard({ operations, loading, onNavigate }: TodayOperationsCardProps) {
  const shifts = Array.isArray(operations.byShift) ? operations.byShift as ShiftGroup[] : [];
  const noShift = numberValue(operations.noShift);
  return <section className="dashboard-panel dashboard-today-operations" aria-label="งานวันนี้">
    <header className="dashboard-panel__header"><div><h2>กำลังพลวันนี้</h2><span>ภาพรวมกำลังพลตามวันที่เลือก</span></div><span className="dashboard-period">ข้อมูลตามวันที่เลือก</span></header>
    {loading ? <div className="dashboard-list-skeleton"><span /><span /><span /></div> : <>
      <div className="dashboard-today-highlight">
        <div><span>กำลังพลวันนี้</span><strong>แยกตามกะ</strong><small>ดูจำนวนตามประเภทกะด้านล่าง</small></div>
        <span className={noShift ? 'dashboard-readiness-badge dashboard-readiness-badge--warning' : 'dashboard-readiness-badge'}>{noShift ? formatMetric(noShift) + ' คนยังไม่มีกะ' : 'ครบทุกกะ'}</span>
      </div>
      <div className="dashboard-shift-groups" aria-label="กำลังพลแยกตามกะวันนี้"><div className="dashboard-subsection-heading"><b>กำลังพลตามกะ</b><small>{shifts.length ? formatMetric(shifts.length) + ' ประเภทกะ' : 'ยังไม่มีรายการกะ'}</small></div>{shifts.length ? shifts.map((shift) => <button type="button" className="dashboard-shift-group" key={String(shift.code || shift.name || 'shift')} onClick={() => onNavigate('schedule')}><span className="dashboard-shift-group__dot" style={shift.color ? { backgroundColor: shift.color } : undefined} /><span><b>{shift.name || shift.code || 'ไม่ระบุกะ'}</b><small>{shift.code || 'จากตารางวันนี้'}</small></span><strong>{formatMetric(numberValue(shift.count))}</strong><i aria-hidden="true">›</i></button>) : <div className="dashboard-empty-inline"><span>–</span><div><b>ไม่มีพนักงานในตารางวันนี้</b><small>ตรวจสอบตารางกะหรือช่วงวันที่ที่เลือก</small></div></div>}</div>
    </>}
  </section>;
}
