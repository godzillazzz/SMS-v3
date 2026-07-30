import { DashboardHeroHeader } from '../../components/dashboard/DashboardHeroHeader';
import { MetricsGrid } from '../../components/dashboard/MetricsGrid';
import { WorkforceOverviewCard } from '../../components/dashboard/WorkforceOverviewCard';
import { AttentionNeededCard } from '../../components/dashboard/AttentionNeededCard';
import { RecentActivityCard } from '../../components/dashboard/RecentActivityCard';
import { QuickActionsCard } from '../../components/dashboard/QuickActionsCard';
import { DataSyncStatusCard } from '../../components/dashboard/DataSyncStatusCard';
import { asNumber, type DashboardNavigate, type DashboardSummary, type DashboardUser } from '../../components/dashboard/types';
import '../../styles/dashboard.css';

type DashboardPageProps = { summary: DashboardSummary; loading: boolean; error?: string; user?: DashboardUser; canManage: boolean; onNavigate: DashboardNavigate };

export function DashboardPage({ summary, loading, error, user, canManage, onNavigate }: DashboardPageProps) {
  const totalEmployees = asNumber(summary.totalEmployees);
  const activeEmployees = asNumber(summary.activeEmployees);
  const monthShifts = asNumber(summary.monthShifts);
  const expiringLicenses = asNumber(summary.expiringLicenses);
  const pendingLeaves = asNumber(summary.pendingLeaves);
  const pendingUsers = asNumber(summary.pendingUsers);
  const rawUnits = summary.organizationalUnits ?? summary.departmentCount;
  const organizationalUnits = rawUnits === undefined || rawUnits === null ? undefined : asNumber(rawUnits);
  const complianceAttention = expiringLicenses + pendingLeaves + pendingUsers;

  return <section className="dashboard-page-v2" aria-label="Executive Operations Dashboard">
    <DashboardHeroHeader user={user} />
    {error && <div className="dashboard-data-error" role="alert"><b>ไม่สามารถโหลดข้อมูล Dashboard ได้</b><span>แสดงสถานะที่มีอยู่ล่าสุด โดยไม่มีการสร้างข้อมูลแทน</span></div>}
    <MetricsGrid totalEmployees={totalEmployees} activeEmployees={activeEmployees} organizationalUnits={organizationalUnits} complianceAttention={complianceAttention} loading={loading} />
    <div className="dashboard-primary-grid"><WorkforceOverviewCard totalEmployees={totalEmployees} activeEmployees={activeEmployees} monthShifts={monthShifts} loading={loading} onNavigate={onNavigate} /><AttentionNeededCard expiringLicenses={expiringLicenses} pendingLeaves={pendingLeaves} pendingUsers={pendingUsers} loading={loading} onNavigate={onNavigate} /></div>
    <div className="dashboard-secondary-grid"><RecentActivityCard /><QuickActionsCard canManage={canManage} onNavigate={onNavigate} /><DataSyncStatusCard /></div>
  </section>;
}
