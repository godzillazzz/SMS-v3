import { MetricCard } from './MetricCard';

type MetricsGridProps = {
  totalEmployees: number;
  activeEmployees: number;
  organizationalUnits?: number;
  complianceAttention: number;
  loading: boolean;
};

export function MetricsGrid({ totalEmployees, activeEmployees, organizationalUnits, complianceAttention, loading }: MetricsGridProps) {
  const unitsAvailable = organizationalUnits !== undefined;
  return <section className="dashboard-metrics" aria-label="ตัวชี้วัดการปฏิบัติงาน">
    <MetricCard icon="◉" label="PERSONNEL RECORDS" value={totalEmployees} context="ข้อมูลพนักงานในระบบ" tone="indigo" loading={loading} />
    <MetricCard icon="✓" label="ACTIVE PERSONNEL" value={activeEmployees} context={totalEmployees ? `${Math.round((activeEmployees / totalEmployees) * 100)}% ของข้อมูลทั้งหมด` : 'ยังไม่มีข้อมูลพนักงาน'} tone="green" loading={loading} />
    <MetricCard icon="⌘" label="ORGANIZATIONAL UNITS" value={organizationalUnits} context="หน่วยงานที่มีข้อมูลรองรับ" tone="teal" loading={loading} unavailable={!loading && !unitsAvailable} />
    <MetricCard icon="!" label="COMPLIANCE ATTENTION" value={complianceAttention} context={complianceAttention ? 'รายการที่ต้องติดตาม' : 'ไม่พบรายการที่ต้องติดตาม'} tone="warning" loading={loading} />
  </section>;
}
