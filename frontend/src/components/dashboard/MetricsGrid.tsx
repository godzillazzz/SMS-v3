import { MetricCard } from './MetricCard';

type MetricsGridProps = {
  totalEmployees: number;
  activeEmployees: number;
  workingToday: number;
  leaveToday: number;
  expiringLicenses: number;
  pendingLicenseDocuments: number;
  notScheduledToday: number;
  loading: boolean;
  onNavigate: (page: 'employees' | 'schedule' | 'leave' | 'licenses') => void;
};

export function MetricsGrid({ totalEmployees, activeEmployees, workingToday, leaveToday, expiringLicenses, pendingLicenseDocuments, notScheduledToday, loading, onNavigate }: MetricsGridProps) {
  return <section className="dashboard-metrics" aria-label="ตัวชี้วัดการปฏิบัติงาน">
    <MetricCard icon="◉" label="พนักงานทั้งหมด" value={totalEmployees} context="ข้อมูลพนักงานที่อยู่ในขอบเขตสิทธิ์" tone="indigo" loading={loading} onClick={() => onNavigate('employees')} ariaLabel="ดูพนักงานทั้งหมด" />
    <MetricCard icon="✓" label="กำลังปฏิบัติงานวันนี้" value={workingToday} context={activeEmployees ? `กำลังใช้งาน ${activeEmployees} คน` : 'ยังไม่มีข้อมูลกำลังพล'} tone="green" loading={loading} onClick={() => onNavigate('schedule')} ariaLabel="ดูตารางกะวันนี้" />
    <MetricCard icon="⌁" label="ลาวันนี้" value={leaveToday} context="คำขอลาที่อยู่ในช่วงวันนี้" tone="teal" loading={loading} onClick={() => onNavigate('leave')} ariaLabel="ดูรายการลาวันนี้" />
    <MetricCard icon="!" label="ใบอนุญาตใกล้หมดอายุ" value={expiringLicenses} context="ภายใน 30 วัน" tone="warning" loading={loading} onClick={() => onNavigate('licenses')} ariaLabel="ดูใบอนุญาตใกล้หมดอายุ" />
    <MetricCard icon="▣" label="เอกสารรอตรวจสอบ" value={pendingLicenseDocuments} context="ใบอนุญาตสถานะ PENDING" tone="warning" loading={loading} onClick={() => onNavigate('licenses')} ariaLabel="ดูเอกสารใบอนุญาตรอตรวจสอบ" />
    <MetricCard icon="⌂" label="ยังไม่มีกะวันนี้" value={notScheduledToday} context="พนักงานที่ active แต่ไม่พบกะ" tone="indigo" loading={loading} onClick={() => onNavigate('schedule')} ariaLabel="ดูพนักงานที่ยังไม่มีกะวันนี้" />
  </section>;
}
