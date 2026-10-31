import { SmsIcon } from '../../components/SmsIcon';
import { DashboardFilterBar } from '../../components/dashboard/DashboardFilterBar';
import { QuickActionsCard } from '../../components/dashboard/QuickActionsCard';
import type { ApprovalCountSummary, ApprovalCountType } from '../../components/approval-count-badge';
import { WorkQueueJourney } from '../../components/dashboard/WorkQueueJourney';
import { RequestErrorReference, type RequestErrorInput } from '../../request-error';
import { asNumber, type DashboardAction, type DashboardActivity, type DashboardExpiringLicense, type DashboardFilters, type DashboardNavigate, type DashboardSummary, type DashboardUser } from '../../components/dashboard/types';
import { PageHeader, SectionCard } from '../../components/layout';
import './dashboard-redesign.css';
import { dashboardDetailQuery, type DashboardDetailMetric } from '../../components/dashboard/deep-links';
import { lazy, Suspense } from 'react';
import { OperationsTodaySection } from '../../components/dashboard/OperationsTodayPanel';
const AnnouncementHomeCard = lazy(() => import('../announcements/AnnouncementHomeCard').then((module) => ({ default: module.AnnouncementHomeCard })));

/* Loaded on demand to keep the main bundle within its budget; the placeholder keeps the layout steady. */
/* Detail cards live inside the collapsed 'รายละเอียด' section, so they load as their own chunk. */
const WorkforceOverviewCard = lazy(() => import('../../components/dashboard/WorkforceOverviewCard').then((module) => ({ default: module.WorkforceOverviewCard })));
const TodayOperationsCard = lazy(() => import('../../components/dashboard/TodayOperationsCard').then((module) => ({ default: module.TodayOperationsCard })));
const AttentionNeededCard = lazy(() => import('../../components/dashboard/AttentionNeededCard').then((module) => ({ default: module.AttentionNeededCard })));
const RecentActivityCard = lazy(() => import('../../components/dashboard/RecentActivityCard').then((module) => ({ default: module.RecentActivityCard })));
const LeaveSummaryCard = lazy(() => import('../../components/dashboard/LeaveSummaryCard').then((module) => ({ default: module.LeaveSummaryCard })));
const LicenseSummaryCard = lazy(() => import('../../components/dashboard/LicenseSummaryCard').then((module) => ({ default: module.LicenseSummaryCard })));
const DataSyncStatusCard = lazy(() => import('../../components/dashboard/DataSyncStatusCard').then((module) => ({ default: module.DataSyncStatusCard })));
const MyWorkQueueCard = lazy(() => import('../../components/dashboard/MyWorkQueueCard').then((module) => ({ default: module.MyWorkQueueCard })));

type DashboardPageProps = { token?: string; summary: DashboardSummary; loading: boolean; error?: RequestErrorInput; user?: DashboardUser; canManage: boolean; filters: DashboardFilters; pendingApprovalCount?: number | null; approvalSummary?: ApprovalCountSummary | null; approvalCountStatus?: 'idle' | 'loading' | 'ready' | 'error'; onOpenApprovalCenter?(type?: ApprovalCountType): void; onFiltersChange: (filters: Partial<DashboardFilters>) => void; onNavigate: DashboardNavigate };

const numberText = (value: unknown) => new Intl.NumberFormat('th-TH').format(asNumber(value));

export function DashboardPage({ token, summary, loading, error, user, canManage, filters, pendingApprovalCount, approvalSummary, approvalCountStatus, onOpenApprovalCenter, onFiltersChange, onNavigate }: DashboardPageProps) {
  const total = asNumber(summary.totalEmployees);
  const active = asNumber(summary.activeEmployees);
  const onDuty = asNumber(summary.onDutyToday ?? summary.workingToday);
  const leave = asNumber(summary.leaveToday);
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
  const syncTime = generatedAt ? new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(generatedAt)) : '—';
  const firstName = user?.displayName?.trim().split(/\s+/)[0] || 'ผู้ใช้งาน';
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Bangkok' }).format(new Date()));
  const greeting = hour < 12 ? 'สวัสดีตอนเช้า' : hour < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  const todayLabel = new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date());
  const followUpTotal = actions.reduce((sum, row) => sum + (Number((row as any).count) || 0), 0);
  const firstFollowUp = actions[0] as any;
  const heroSummary = loading ? 'กำลังอ่านข้อมูลภาพรวม…' : followUpTotal > 0
    ? `มี ${numberText(followUpTotal)} รายการที่ต้องติดตาม${firstFollowUp ? ` · เริ่มจาก${String(firstFollowUp.title || firstFollowUp.label || '')} ${numberText(firstFollowUp.count)} รายการ` : ''}`
    : 'ไม่มีรายการค้างที่ต้องติดตามในตัวกรองนี้';
  const partialErrors = Array.isArray(summary.partialErrors) ? summary.partialErrors : [];
  const navigateMetric = (metric: DashboardDetailMetric, selector: Record<string, string | undefined> = {}) =>
    onNavigate('dashboardDetails', dashboardDetailQuery(metric, filters, user?.role, selector));
  const deepLinkNavigate: DashboardNavigate = (page, selector) => {
    if (page === 'dashboardDetails') {
      const metric = selector?.metric as DashboardDetailMetric | undefined;
      if (metric) onNavigate(page, dashboardDetailQuery(metric, filters, user?.role, selector));
      return;
    }
    onNavigate(page);
  };

  return <section className="nexus-command layout-page-surface dashboard-redesign" aria-label="ภาพรวม">
    <PageHeader kicker={todayLabel} title="ภาพรวมระบบ" lead={`${greeting}, ${firstName}`} description={heroSummary} actions={<div className="dashboard-hero__actions"><button type="button" onClick={() => onNavigate('employees')}><SmsIcon name="search" size={16} />ค้นหาพนักงาน</button><button type="button" onClick={() => onNavigate('schedule')}><SmsIcon name="calendar" size={16} />ตารางกะรายเดือน</button>{canManage && <button type="button" className="is-primary" onClick={() => onOpenApprovalCenter?.('LEAVE_REQUEST')}><SmsIcon name="leave" size={16} />ตรวจคำขอลา</button>}</div>} className="nexus-command__hero dashboard-hero" />

    {token && canManage && <OperationsTodaySection token={token} onNavigate={onNavigate} announcements={<Suspense fallback={null}><AnnouncementHomeCard token={token} onOpenAll={() => onNavigate('announcements')} /></Suspense>} />}
    {token && !canManage && <Suspense fallback={null}><AnnouncementHomeCard token={token} onOpenAll={() => onNavigate('announcements')} /></Suspense>}

    <DashboardFilterBar filters={filters} departments={departments} role={user?.role} loading={loading} onChange={onFiltersChange} />

    {error ? <div className="nexus-command__alert dashboard-data-error" role="alert"><strong>ข้อมูลไม่พร้อมใช้งาน</strong><span>โหลดภาพรวมไม่สำเร็จ ระบบไม่สร้างข้อมูลแทน</span><RequestErrorReference requestId={typeof error === 'string' ? undefined : error?.requestId} /></div> : partialErrors.length > 0 ? <div className="nexus-command__alert dashboard-data-warning" role="status"><strong>ข้อมูลบางส่วนไม่พร้อม</strong><span>ข้อมูลพร้อมแสดงตามสิทธิ์</span></div> : null}

    <div className="dashboard-redesign__top">
    {canManage && <Suspense fallback={<section className="my-work-queue" aria-label="งานของฉัน" aria-busy="true" />}><MyWorkQueueCard summary={approvalSummary} status={approvalCountStatus === 'error' ? 'error' : approvalSummary ? 'ready' : 'loading'} onOpen={(type) => onOpenApprovalCenter?.(type)} /></Suspense>}


    <section className="nexus-command__grid dashboard-command-grid">
      <article className="nexus-stream nexus-panel" aria-label="รายการที่ต้องดำเนินการ">
        <header><div><p className="nexus-kicker">จากข้อมูลภาพรวม</p><h2>ต้องดูวันนี้</h2></div><b>{actions.length}</b></header>
        <div className="nexus-stream__list">{loading ? <div className="nexus-loading">กำลังอ่านข้อมูล…</div> : actions.length ? actions.slice(0,5).map((row, index) => <div className="nexus-stream__item" key={String((row as any).id || index)}><span className="nexus-stream__pulse"/><i className="dashboard-follow-icon" aria-hidden="true"><SmsIcon name="bell" size={17} /></i><div><strong>{String((row as any).title || (row as any).label || (row as any).type || 'รายการที่ต้องตรวจสอบ')}</strong><small>{String((row as any).description || (row as any).detail || 'เปิดดูรายละเอียด')}</small></div><em>{String((row as any).count || '')}</em></div>) : <div className="nexus-clear"><SmsIcon name="check" size={28}/><strong>ไม่มีรายการค้าง</strong><span>ไม่มีงานเร่งด่วน</span></div>}</div>
        {canManage && <button className="nexus-stream__cta dashboard-approval-alert" type="button" onClick={() => onOpenApprovalCenter?.()}>เปิดศูนย์อนุมัติ {pendingApprovalCount != null && pendingApprovalCount > 0 && <span>{pendingApprovalCount > 99 ? '99+' : pendingApprovalCount}</span>}</button>}
      </article>
    </section>
    </div>

    <section className="nexus-kpis-card" aria-label="ตัวชี้วัด">
    <div className="nexus-kpis">
      <button type="button" onClick={() => navigateMetric('activeEmployees')}><i className="dashboard-kpi-icon" aria-hidden="true"><SmsIcon name="employees" size={18} /></i><span>พนักงานปฏิบัติงาน</span><strong>{numberText(active)}<small> / {numberText(total)}</small></strong><em>{total ? Math.round(active/total*100) : 0}% พร้อมทำงาน</em></button>
      <button type="button" onClick={() => navigateMetric('schedule', { workforce: 'ON_DUTY' })}><i className="dashboard-kpi-icon" aria-hidden="true"><SmsIcon name="calendar" size={18} /></i><span>ทำงานวันนี้</span><strong>{numberText(onDuty)}</strong><em>ตามตารางกะ</em></button>
      <button type="button" onClick={() => navigateMetric('leaveToday')}><i className="dashboard-kpi-icon" aria-hidden="true"><SmsIcon name="leave" size={18} /></i><span>ลาวันนี้</span><strong>{numberText(leave)}</strong><em>บุคลากรที่ลาในวันที่เลือก</em></button>
      <button type="button" onClick={() => navigateMetric('licenseExpiry', { expiryBucket: 'EXPIRING_0_30' })}><i className="dashboard-kpi-icon" aria-hidden="true"><SmsIcon name="license" size={18} /></i><span>ใบอนุญาตใกล้หมดอายุ</span><strong>{numberText(expiring)}</strong><em>{expiring ? 'ควรตรวจสอบ' : 'ไม่มีรายการใกล้หมดอายุ'}</em></button>
    </div>
    </section>

    <QuickActionsCard canManage={canManage} onNavigate={onNavigate} />

    <details className="dashboard-redesign__details">
    <summary><span>รายละเอียด</span><small>กำลังพลตามกะ · การลาและใบอนุญาต · กิจกรรมล่าสุด · สถานะข้อมูล</small></summary>
    <WorkQueueJourney canManage={canManage} pendingApprovalCount={pendingApprovalCount} onOpenApprovalCenter={() => onOpenApprovalCenter?.()} onNavigate={onNavigate} />
    <Suspense fallback={<p className="nexus-loading">กำลังโหลดรายละเอียด…</p>}>
    <section className="nexus-legacy-data" aria-label="รายละเอียด">
      <div className="nexus-section-heading"><div><p className="nexus-kicker">ข้อมูลที่ตรวจสอบแล้ว</p><h2>ข้อมูลปฏิบัติการ</h2></div><span>ข้อมูลจากระบบ</span></div>
      <div className="dashboard-command-grid dashboard-primary-grid"><AttentionNeededCard rows={actions} expiringLicenses={expiringLicenseDetails} expiringCount={expiring} loading={loading} onNavigate={deepLinkNavigate} /><TodayOperationsCard operations={todayOperations} totalEmployees={total} activeEmployees={active} loading={loading} onNavigate={deepLinkNavigate} /></div>
      <div className="dashboard-secondary-grid"><WorkforceOverviewCard totalEmployees={total} activeEmployees={active} workingToday={asNumber(summary.workingToday)} notScheduledToday={notScheduledToday} monthShifts={monthShifts} loading={loading} onNavigate={deepLinkNavigate} /><LeaveSummaryCard summary={leaveOverview} loading={loading} canManage={canManage} canAdmin={canAdmin} onNavigate={deepLinkNavigate} /><LicenseSummaryCard summary={licenseSummary} overview={licenseOverview} expiring={expiring} loading={loading} onNavigate={deepLinkNavigate} /></div>
      <div className="dashboard-tertiary-grid"><RecentActivityCard activities={activities} /><DataSyncStatusCard generatedAt={generatedAt} /></div>
    </section>

    <section className="nexus-lower-grid">
      <article className="nexus-panel nexus-readiness"><header><div><p className="nexus-kicker">ความพร้อมกำลังพล</p><h2>พนักงานและตารางกะ</h2></div><button onClick={() => onNavigate('schedule')}>ดูตารางกะ ↗</button></header><div className="nexus-readiness__meter"><span style={{width:`${total ? Math.min(100,active/total*100) : 0}%`}}/></div><div className="nexus-readiness__stats"><span><b>{numberText(total)}</b>ทั้งหมด</span><span><b>{numberText(active)}</b>ปฏิบัติงาน</span><span><b>{numberText(onDuty)}</b>ทำงานวันนี้</span></div></article>
      <article className="nexus-panel nexus-activity"><header><div><p className="nexus-kicker">กิจกรรมที่บันทึก</p><h2>กิจกรรมล่าสุด</h2></div><span className="nexus-state">อ่านอย่างเดียว</span></header><div>{activities.length ? activities.slice(0,4).map((row,index)=><p key={String((row as any).id||index)}><i/><span><strong>{String((row as any).title || (row as any).action || 'กิจกรรมในระบบ')}</strong><small>{String((row as any).description || (row as any).detail || '')}</small></span></p>) : <p className="nexus-activity__empty"><span><strong>ไม่มีกิจกรรมล่าสุด</strong><small>ไม่มีกิจกรรมจากข้อมูลปัจจุบัน</small></span></p>}</div></article>
    </section>
    </Suspense>
    </details>
  </section>;
}
