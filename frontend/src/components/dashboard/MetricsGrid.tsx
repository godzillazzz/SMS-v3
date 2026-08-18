import { MetricCard } from './MetricCard';
import { formatMetric } from './types';

type MetricsGridProps = {
  totalEmployees: number;
  activeEmployees: number;
  workingToday: number;
  leaveToday: number;
  pendingLeaves: number;
  attentionCount: number;
  expiringLicenses: number;
  pendingLicenseDocuments: number;
  notScheduledToday: number;
  loading: boolean;
  onNavigate: (page: 'employees' | 'schedule' | 'leave' | 'licenses' | 'leavePending') => void;
};

export function MetricsGrid({ totalEmployees, activeEmployees, workingToday, leaveToday, pendingLeaves, attentionCount, expiringLicenses, pendingLicenseDocuments, notScheduledToday, loading, onNavigate }: MetricsGridProps) {
  const workingContext = activeEmployees ? 'จาก ' + formatMetric(activeEmployees) + ' คนที่ active' : 'ยังไม่มีข้อมูลกำลังพล';
  return <section className="dashboard-kpi-section" aria-label="ตัวชี้วัดสำคัญ">
    <div className="dashboard-kpi-heading">
      <div><h2>ภาพรวมวันนี้</h2></div>
      <small>ตัวเลขสำคัญจากข้อมูลจริงตามวันที่และขอบเขตที่เลือก</small>
    </div>
    <div className="dashboard-metrics" aria-label="ตัวชี้วัดการปฏิบัติงาน">
      <MetricCard icon="calendar" label="กำลังปฏิบัติงาน" value={workingToday} context={workingContext} tone="green" loading={loading} onClick={() => onNavigate('schedule')} ariaLabel="ดูตารางกะวันนี้" />
      <MetricCard icon="leave" label="ลาวันนี้" value={leaveToday} context="บุคลากรที่ลาในวันที่เลือก" tone="teal" loading={loading} onClick={() => onNavigate('leave')} ariaLabel="ดูรายการลาวันนี้" />
      <MetricCard icon="approval" label="รออนุมัติ" value={pendingLeaves} context="คำขอลาที่รอการพิจารณา" tone="warning" loading={loading} onClick={() => onNavigate('leavePending')} ariaLabel="ดูคำขอลาที่รออนุมัติ" />
      <MetricCard icon="shield" label="ต้องติดตาม" value={attentionCount} context={attentionCount ? 'กลุ่มงานที่ต้องดำเนินการ' : 'ไม่มีรายการเร่งด่วน'} tone="urgent" loading={loading} />
    </div>
    <div className="dashboard-secondary-metrics" aria-label="ข้อมูลประกอบ">
      <button type="button" className="dashboard-secondary-metric" onClick={() => onNavigate('employees')}><span>พนักงานทั้งหมด</span><strong>{loading ? '—' : formatMetric(totalEmployees)}</strong><small>ในขอบเขตสิทธิ์</small></button>
      <button type="button" className="dashboard-secondary-metric" onClick={() => onNavigate('licenses')}><span>ใบอนุญาตใกล้หมดอายุ</span><strong>{loading ? '—' : formatMetric(expiringLicenses)}</strong><small>ภายใน 30 วัน</small></button>
      <button type="button" className="dashboard-secondary-metric" onClick={() => onNavigate('licenses')}><span>เอกสารรอตรวจ</span><strong>{loading ? '—' : formatMetric(pendingLicenseDocuments)}</strong><small>สถานะ PENDING</small></button>
      <button type="button" className="dashboard-secondary-metric" onClick={() => onNavigate('schedule')}><span>ยังไม่มีกะวันนี้</span><strong>{loading ? '—' : formatMetric(notScheduledToday)}</strong><small>active แต่ไม่พบกะ</small></button>
    </div>
  </section>;
}
