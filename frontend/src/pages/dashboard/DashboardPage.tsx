import { SmsIcon } from '../../components/SmsIcon';
import { DashboardFilterBar } from '../../components/dashboard/DashboardFilterBar';
import { WorkforceOverviewCard } from '../../components/dashboard/WorkforceOverviewCard';
import { TodayOperationsCard } from '../../components/dashboard/TodayOperationsCard';
import { AttentionNeededCard } from '../../components/dashboard/AttentionNeededCard';
import { RecentActivityCard } from '../../components/dashboard/RecentActivityCard';
import { QuickActionsCard } from '../../components/dashboard/QuickActionsCard';
import { WorkQueueJourney } from '../../components/dashboard/WorkQueueJourney';
import { DataSyncStatusCard } from '../../components/dashboard/DataSyncStatusCard';
import { LeaveSummaryCard } from '../../components/dashboard/LeaveSummaryCard';
import { LicenseSummaryCard } from '../../components/dashboard/LicenseSummaryCard';
import { RequestErrorReference, type RequestErrorInput } from '../../request-error';
import { asNumber, type DashboardAction, type DashboardActivity, type DashboardExpiringLicense, type DashboardFilters, type DashboardNavigate, type DashboardSummary, type DashboardUser } from '../../components/dashboard/types';

type DashboardPageProps = { summary: DashboardSummary; loading: boolean; error?: RequestErrorInput; user?: DashboardUser; canManage: boolean; filters: DashboardFilters; pendingApprovalCount?: number | null; onOpenApprovalCenter?(): void; onFiltersChange: (filters: Partial<DashboardFilters>) => void; onNavigate: DashboardNavigate };

const numberText = (value: unknown) => new Intl.NumberFormat('th-TH').format(asNumber(value));

export function DashboardPage({ summary, loading, error, user, canManage, filters, pendingApprovalCount, onOpenApprovalCenter, onFiltersChange, onNavigate }: DashboardPageProps) {
  const total = asNumber(summary.totalEmployees);
  const active = asNumber(summary.activeEmployees);
  const onDuty = asNumber(summary.onDutyToday ?? summary.workingToday);
  const leave = asNumber(summary.leaveToday);
  const pending = asNumber(summary.pendingLeaves);
  const expiring = asNumber(summary.expiringLicenses);
  // Keep the established dashboard data contract intact while presenting it through the Command Nexus shell.
  const pendingLicenseDocuments = asNumber(summary.pendingLicenseDocuments);
  const notScheduledToday = asNumber(summary.notScheduledToday);
  const monthShifts = asNumber(summary.monthShifts);
  const licenseSummary = summary.licenseSummary && typeof summary.licenseSummary === 'object' ? summary.licenseSummary as Record<string, unknown> : {};
  const leaveSummary = summary.leaveSummary && typeof summary.leaveSummary === 'object' ? summary.leaveSummary as Record<string, unknown> : {};
  const leaveOverview = summary.leaveOverview && typeof summary.leaveOverview === 'object' ? summary.leaveOverview as Record<string, unknown> : leaveSummary;
  const licenseOverview = summary.licenseOverview && typeof summary.licenseOverview === 'object' ? summary.licenseOverview as Record<string, unknown> : {};
  const todayOperations = summary.todayOperations && typeof summary.todayOperations === 'object' ? summary.todayOperations as Record<string, unknown> : {};
  const expiringLicenseDetails = Array.isArray(summary.expiringLicenseDetails) ? summary.expiringLicenseDetails as DashboardExpiringLicense[] : [];
  const context = summary.context && typeof summary.context === 'object' ? summary.context as Record<string, unknown> : {};
  const departments = Array.isArray(context.departments) ? context.departments.map(String) : [];
  const canAdmin = user?.role === 'ADMIN';
  const actions = Array.isArray(summary.actionRequired) ? summary.actionRequired as DashboardAction[] : [];
  const activities = Array.isArray(summary.recentActivity) ? summary.recentActivity as DashboardActivity[] : [];
  const generatedAt = typeof summary.generatedAt === 'string' ? summary.generatedAt : undefined;
  const syncTime = generatedAt ? new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(generatedAt)) : 'WAITING';
  const firstName = user?.displayName?.trim().split(/\s+/)[0] || 'Operator';
  const partialErrors = Array.isArray(summary.partialErrors) ? summary.partialErrors : [];

  return <section className="nexus-command" aria-label="SMS Command Overview">
    <header className="nexus-command__hero">
      <div><p className="nexus-kicker">ภาพรวมการปฏิบัติงาน</p><h1>Command Overview</h1><p>ศูนย์ควบคุมสถานะกำลังพล งานที่ต้องดำเนินการ และข้อมูลปฏิบัติการตามสิทธิ์ของคุณ</p></div>
      <div className="nexus-hero-status"><span><i /> AUTHENTICATED</span><strong>{firstName}</strong><small>SYNC {syncTime}</small></div>
    </header>

    <DashboardFilterBar filters={filters} departments={departments} role={user?.role} loading={loading} onChange={onFiltersChange} />

    <WorkQueueJourney canManage={canManage} pendingApprovalCount={pendingApprovalCount} onOpenApprovalCenter={onOpenApprovalCenter} onNavigate={onNavigate} />

    {error ? <div className="nexus-command__alert dashboard-data-error" role="alert"><strong>DATA CHANNEL DEGRADED</strong><span>ไม่สามารถโหลดข้อมูล Dashboard ได้ ระบบจะไม่สร้างข้อมูลทดแทน</span><RequestErrorReference requestId={typeof error === 'string' ? undefined : error?.requestId} /></div> : partialErrors.length > 0 ? <div className="nexus-command__alert dashboard-data-warning" role="status"><strong>PARTIAL DATA CHANNEL</strong><span>ข้อมูลบางส่วนยังไม่พร้อม ส่วนที่พร้อมยังแสดงตามสิทธิ์ของคุณ</span></div> : null}

    <section className="nexus-command__grid dashboard-command-grid">
      <article className="nexus-stream nexus-panel">
        <header><div><p className="nexus-kicker">PRIORITY STREAM</p><h2>Attention Required</h2></div><b>{actions.length}</b></header>
        <div className="nexus-stream__list">{loading ? <div className="nexus-loading">READING SECURE CHANNEL…</div> : actions.length ? actions.slice(0,5).map((row, index) => <div className="nexus-stream__item" key={String((row as any).id || index)}><span className="nexus-stream__pulse"/><div><strong>{String((row as any).title || (row as any).label || (row as any).type || 'รายการที่ต้องตรวจสอบ')}</strong><small>{String((row as any).description || (row as any).detail || 'เปิดข้อมูลที่เกี่ยวข้องเพื่อตรวจสอบรายละเอียด')}</small></div><em>{String((row as any).count || '')}</em></div>) : <div className="nexus-clear"><SmsIcon name="check" size={28}/><strong>QUEUE CLEAR</strong><span>ไม่มีรายการเร่งด่วนจากข้อมูลที่ระบบได้รับ</span></div>}</div>
        {canManage && <button className="nexus-stream__cta dashboard-approval-alert" type="button" onClick={() => onOpenApprovalCenter?.()}>OPEN APPROVAL CENTER {pendingApprovalCount != null && pendingApprovalCount > 0 && <span>{pendingApprovalCount > 99 ? '99+' : pendingApprovalCount}</span>}</button>}
      </article>
    </section>

    <section className="nexus-kpis" aria-label="Operational metrics">
      <button type="button" onClick={() => onNavigate('employees')}><span>ACTIVE PERSONNEL</span><strong>{numberText(active)}<small> / {numberText(total)}</small></strong><em>{total ? Math.round(active/total*100) : 0}% READY</em></button>
      <button type="button" onClick={() => onNavigate('schedule')}><span>ON DUTY TODAY</span><strong>{numberText(onDuty)}</strong><em>VERIFIED SCHEDULE</em></button>
      <button type="button" onClick={() => onNavigate('leavePending')}><span>LEAVE / PENDING</span><strong>{numberText(leave)}<small> / {numberText(pending)}</small></strong><em>WORKFORCE FLOW</em></button>
      <button type="button" onClick={() => onNavigate('licenses')}><span>LICENSE WATCH</span><strong>{numberText(expiring)}</strong><em>{expiring ? 'REQUIRES REVIEW' : 'NO EXPIRY ALERT'}</em></button>
    </section>

    <section className="nexus-legacy-data" aria-label="Dashboard operational details">
      <div className="nexus-section-heading"><div><p className="nexus-kicker">OPERATIONAL DATA / VERIFIED CHANNELS</p><h2>ข้อมูลปฏิบัติการ</h2></div><span>LIVE FROM DASHBOARD API</span></div>
      <div className="dashboard-command-grid dashboard-primary-grid"><AttentionNeededCard rows={actions} expiringLicenses={expiringLicenseDetails} loading={loading} onNavigate={onNavigate} /><TodayOperationsCard operations={todayOperations} totalEmployees={total} activeEmployees={active} loading={loading} onNavigate={onNavigate} /></div>
      <QuickActionsCard canManage={canManage} onNavigate={onNavigate} />
      <div className="dashboard-secondary-grid"><WorkforceOverviewCard totalEmployees={total} activeEmployees={active} workingToday={asNumber(summary.workingToday)} notScheduledToday={notScheduledToday} monthShifts={monthShifts} loading={loading} onNavigate={onNavigate} /><LeaveSummaryCard summary={leaveOverview} loading={loading} canManage={canManage} canAdmin={canAdmin} onNavigate={onNavigate} /><LicenseSummaryCard summary={licenseSummary} overview={licenseOverview} expiring={expiring} loading={loading} onNavigate={onNavigate} /></div>
      <div className="dashboard-tertiary-grid"><RecentActivityCard activities={activities} /><DataSyncStatusCard generatedAt={generatedAt} /></div>
    </section>

    <section className="nexus-lower-grid">
      <article className="nexus-panel nexus-readiness"><header><div><p className="nexus-kicker">WORKFORCE READINESS</p><h2>Personnel / Roster</h2></div><button onClick={() => onNavigate('schedule')}>ROSTER ↗</button></header><div className="nexus-readiness__meter"><span style={{width:`${total ? Math.min(100,active/total*100) : 0}%`}}/></div><div className="nexus-readiness__stats"><span><b>{numberText(total)}</b>TOTAL</span><span><b>{numberText(active)}</b>ACTIVE</span><span><b>{numberText(onDuty)}</b>ON DUTY</span></div></article>
      <article className="nexus-panel nexus-activity"><header><div><p className="nexus-kicker">AUDITED ACTIVITY</p><h2>Recent Signal</h2></div><span className="nexus-state">READ ONLY</span></header><div>{activities.length ? activities.slice(0,4).map((row,index)=><p key={String((row as any).id||index)}><i/><span><strong>{String((row as any).title || (row as any).action || 'System activity')}</strong><small>{String((row as any).description || (row as any).detail || '')}</small></span></p>) : <p className="nexus-activity__empty"><span><strong>NO RECENT SIGNAL</strong><small>ยังไม่มีกิจกรรมล่าสุดจากข้อมูลปัจจุบัน</small></span></p>}</div></article>
    </section>
  </section>;
}
