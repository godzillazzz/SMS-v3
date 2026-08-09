import { DashboardHeroHeader } from '../../components/dashboard/DashboardHeroHeader';
import { DashboardFilterBar } from '../../components/dashboard/DashboardFilterBar';
import { MetricsGrid } from '../../components/dashboard/MetricsGrid';
import { WorkforceOverviewCard } from '../../components/dashboard/WorkforceOverviewCard';
import { TodayOperationsCard } from '../../components/dashboard/TodayOperationsCard';
import { AttentionNeededCard } from '../../components/dashboard/AttentionNeededCard';
import { RecentActivityCard } from '../../components/dashboard/RecentActivityCard';
import { QuickActionsCard } from '../../components/dashboard/QuickActionsCard';
import { DataSyncStatusCard } from '../../components/dashboard/DataSyncStatusCard';
import { LeaveSummaryCard } from '../../components/dashboard/LeaveSummaryCard';
import { LicenseSummaryCard } from '../../components/dashboard/LicenseSummaryCard';
import { asNumber, type DashboardAction, type DashboardActivity, type DashboardExpiringLicense, type DashboardFilters, type DashboardNavigate, type DashboardSummary, type DashboardUser } from '../../components/dashboard/types';
import '../../styles/dashboard.css';

type DashboardPageProps = { summary: DashboardSummary; loading: boolean; error?: string; user?: DashboardUser; canManage: boolean; filters: DashboardFilters; onFiltersChange: (filters: Partial<DashboardFilters>) => void; onNavigate: DashboardNavigate };

export function DashboardPage({ summary, loading, error, user, canManage, filters, onFiltersChange, onNavigate }: DashboardPageProps) {
  const totalEmployees = asNumber(summary.totalEmployees);
  const activeEmployees = asNumber(summary.activeEmployees);
  const scheduledToday = asNumber(summary.workingToday);
  const onDutyToday = asNumber(summary.onDutyToday ?? scheduledToday);
  const leaveToday = asNumber(summary.leaveToday);
  const pendingLeaves = asNumber(summary.pendingLeaves);
  const monthShifts = asNumber(summary.monthShifts);
  const expiringLicenses = asNumber(summary.expiringLicenses);
  const pendingLicenseDocuments = asNumber(summary.pendingLicenseDocuments);
  const notScheduledToday = asNumber(summary.notScheduledToday);
  const licenseSummary = summary.licenseSummary && typeof summary.licenseSummary === 'object' ? summary.licenseSummary as Record<string, unknown> : {};
  const leaveSummary = summary.leaveSummary && typeof summary.leaveSummary === 'object' ? summary.leaveSummary as Record<string, unknown> : {};
  const actionRows = Array.isArray(summary.actionRequired) ? summary.actionRequired as DashboardAction[] : [];
  const expiringLicenseDetails = Array.isArray(summary.expiringLicenseDetails) ? summary.expiringLicenseDetails as DashboardExpiringLicense[] : [];
  const activities = Array.isArray(summary.recentActivity) ? summary.recentActivity as DashboardActivity[] : [];
  const context = summary.context && typeof summary.context === 'object' ? summary.context as Record<string, unknown> : {};
  const todayOperations = summary.todayOperations && typeof summary.todayOperations === 'object' ? summary.todayOperations as Record<string, unknown> : {};
  const leaveOverview = summary.leaveOverview && typeof summary.leaveOverview === 'object' ? summary.leaveOverview as Record<string, unknown> : leaveSummary;
  const licenseOverview = summary.licenseOverview && typeof summary.licenseOverview === 'object' ? summary.licenseOverview as Record<string, unknown> : {};
  const departments = Array.isArray(context.departments) ? context.departments.map(String) : [];
  const partialErrors = Array.isArray(summary.partialErrors) ? summary.partialErrors : [];
  const canAdmin = user?.role === 'ADMIN';
  const attentionCount = actionRows.length;

  return <section className="dashboard-page-v2" aria-label="Executive Operations Dashboard">
    <DashboardHeroHeader user={user} />
    <DashboardFilterBar filters={filters} departments={departments} role={user?.role} loading={loading} onChange={onFiltersChange} />
    {error && <div className="dashboard-data-error" role="alert"><b>ไม่สามารถโหลดข้อมูล Dashboard ได้</b><span>แสดงสถานะที่มีอยู่ล่าสุด โดยไม่มีการสร้างข้อมูลแทน</span></div>}
    {!error && partialErrors.length > 0 && <div className="dashboard-data-warning" role="status"><b>ข้อมูลบางส่วนยังไม่พร้อม</b><span>ส่วนที่พร้อมใช้งานยังแสดงตามสิทธิ์ของคุณ และระบบจะลองโหลดใหม่เมื่อมีการรีเฟรช</span></div>}
    <MetricsGrid totalEmployees={totalEmployees} activeEmployees={activeEmployees} workingToday={onDutyToday} leaveToday={leaveToday} pendingLeaves={pendingLeaves} attentionCount={attentionCount} expiringLicenses={expiringLicenses} pendingLicenseDocuments={pendingLicenseDocuments} notScheduledToday={notScheduledToday} loading={loading} onNavigate={onNavigate} />
    <div className="dashboard-command-grid dashboard-primary-grid"><TodayOperationsCard operations={todayOperations} totalEmployees={totalEmployees} activeEmployees={activeEmployees} loading={loading} onNavigate={onNavigate} /><AttentionNeededCard rows={actionRows} expiringLicenses={expiringLicenseDetails} loading={loading} onNavigate={onNavigate} /></div>
    <div className="dashboard-secondary-grid"><WorkforceOverviewCard totalEmployees={totalEmployees} activeEmployees={activeEmployees} workingToday={scheduledToday} notScheduledToday={notScheduledToday} monthShifts={monthShifts} loading={loading} onNavigate={onNavigate} /><LeaveSummaryCard summary={leaveOverview} loading={loading} canManage={canManage} canAdmin={canAdmin} onNavigate={onNavigate} /><LicenseSummaryCard summary={licenseSummary} overview={licenseOverview} expiring={expiringLicenses} loading={loading} onNavigate={onNavigate} /></div>
    <div className="dashboard-tertiary-grid"><RecentActivityCard activities={activities} /><QuickActionsCard canManage={canManage} onNavigate={onNavigate} /><DataSyncStatusCard generatedAt={typeof summary.generatedAt === 'string' ? summary.generatedAt : undefined} /></div>
  </section>;
}
