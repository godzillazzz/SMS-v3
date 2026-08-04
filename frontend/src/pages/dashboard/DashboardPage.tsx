import { DashboardHeroHeader } from '../../components/dashboard/DashboardHeroHeader';
import { MetricsGrid } from '../../components/dashboard/MetricsGrid';
import { WorkforceOverviewCard } from '../../components/dashboard/WorkforceOverviewCard';
import { AttentionNeededCard } from '../../components/dashboard/AttentionNeededCard';
import { RecentActivityCard } from '../../components/dashboard/RecentActivityCard';
import { QuickActionsCard } from '../../components/dashboard/QuickActionsCard';
import { DataSyncStatusCard } from '../../components/dashboard/DataSyncStatusCard';
import { LeaveSummaryCard } from '../../components/dashboard/LeaveSummaryCard';
import { LicenseSummaryCard } from '../../components/dashboard/LicenseSummaryCard';
import { asNumber, type DashboardAction, type DashboardActivity, type DashboardExpiringLicense, type DashboardNavigate, type DashboardSummary, type DashboardUser } from '../../components/dashboard/types';
import '../../styles/dashboard.css';

type DashboardPageProps = { summary: DashboardSummary; loading: boolean; error?: string; user?: DashboardUser; canManage: boolean; onNavigate: DashboardNavigate };

export function DashboardPage({ summary, loading, error, user, canManage, onNavigate }: DashboardPageProps) {
  const totalEmployees = asNumber(summary.totalEmployees);
  const activeEmployees = asNumber(summary.activeEmployees);
  const workingToday = asNumber(summary.workingToday);
  const leaveToday = asNumber(summary.leaveToday);
  const monthShifts = asNumber(summary.monthShifts);
  const expiringLicenses = asNumber(summary.expiringLicenses);
  const pendingLicenseDocuments = asNumber(summary.pendingLicenseDocuments);
  const notScheduledToday = asNumber(summary.notScheduledToday);
  const licenseSummary = summary.licenseSummary && typeof summary.licenseSummary === 'object' ? summary.licenseSummary as Record<string, unknown> : {};
  const leaveSummary = summary.leaveSummary && typeof summary.leaveSummary === 'object' ? summary.leaveSummary as Record<string, unknown> : {};
  const actionRows = Array.isArray(summary.actionRequired) ? summary.actionRequired as DashboardAction[] : [];
  const expiringLicenseDetails = Array.isArray(summary.expiringLicenseDetails) ? summary.expiringLicenseDetails as DashboardExpiringLicense[] : [];
  const activities = Array.isArray(summary.recentActivity) ? summary.recentActivity as DashboardActivity[] : [];
  const canAdmin = user?.role === 'ADMIN';

  return <section className="dashboard-page-v2" aria-label="Executive Operations Dashboard">
    <DashboardHeroHeader user={user} />
    {error && <div className="dashboard-data-error" role="alert"><b>ไม่สามารถโหลดข้อมูล Dashboard ได้</b><span>แสดงสถานะที่มีอยู่ล่าสุด โดยไม่มีการสร้างข้อมูลแทน</span></div>}
    <MetricsGrid totalEmployees={totalEmployees} activeEmployees={activeEmployees} workingToday={workingToday} leaveToday={leaveToday} expiringLicenses={expiringLicenses} pendingLicenseDocuments={pendingLicenseDocuments} notScheduledToday={notScheduledToday} loading={loading} onNavigate={onNavigate} />
    <div className="dashboard-primary-grid"><WorkforceOverviewCard totalEmployees={totalEmployees} activeEmployees={activeEmployees} workingToday={workingToday} notScheduledToday={notScheduledToday} monthShifts={monthShifts} loading={loading} onNavigate={onNavigate} /><AttentionNeededCard rows={actionRows} expiringLicenses={expiringLicenseDetails} loading={loading} onNavigate={onNavigate} /></div>
    <div className="dashboard-secondary-grid"><LicenseSummaryCard summary={licenseSummary} expiring={expiringLicenses} loading={loading} onNavigate={onNavigate} /><LeaveSummaryCard summary={leaveSummary} loading={loading} canManage={canManage} canAdmin={canAdmin} onNavigate={onNavigate} /><RecentActivityCard activities={activities} /></div>
    <div className="dashboard-tertiary-grid"><QuickActionsCard canManage={canManage} onNavigate={onNavigate} /><DataSyncStatusCard generatedAt={typeof summary.generatedAt === 'string' ? summary.generatedAt : undefined} /></div>
  </section>;
}
