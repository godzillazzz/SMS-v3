import { SmsIcon } from '../../components/SmsIcon';
import { DashboardFilterBar } from '../../components/dashboard/DashboardFilterBar';
import { TodayOperationsCard } from '../../components/dashboard/TodayOperationsCard';
import { AttentionNeededCard } from '../../components/dashboard/AttentionNeededCard';
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
  const expiring = asNumber(summary.expiringLicenses);
  // Keep the established dashboard data contract intact while presenting it through the Command Nexus shell.
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
  const attentionActions = actions.filter((row) => !['licensePending', 'licenseExpired', 'licenseExpiring', 'missingSchedule', 'unmatchedQuota', 'pendingLeaves'].includes(row.key));
  const activities = Array.isArray(summary.recentActivity) ? summary.recentActivity as DashboardActivity[] : [];
  const generatedAt = typeof summary.generatedAt === 'string' ? summary.generatedAt : undefined;
  const syncTime = generatedAt ? new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(generatedAt)) : '—';
  const firstName = user?.displayName?.trim().split(/\s+/)[0] || 'ผู้ใช้งาน';
  const partialErrors = Array.isArray(summary.partialErrors) ? summary.partialErrors : [];

  return <section className="nexus-command" aria-label="ภาพรวม">
    <header className="nexus-command__hero">
      <div><p className="nexus-kicker">ภาพรวม</p><h1>ภาพรวมระบบ</h1><p>กำลังพล งานค้าง และข้อมูลตามสิทธิ์</p></div>
      <div className="nexus-hero-status"><span><i /> เข้าสู่ระบบ</span><strong>{firstName}</strong><small>อัปเดตล่าสุด {syncTime}</small></div>
    </header>

    <DashboardFilterBar filters={filters} departments={departments} role={user?.role} loading={loading} onChange={onFiltersChange} />

    <AttentionNeededCard rows={attentionActions} expiringLicenses={expiringLicenseDetails} loading={loading} onNavigate={onNavigate} />

    <WorkQueueJourney canManage={canManage} pendingApprovalCount={pendingApprovalCount} onOpenApprovalCenter={onOpenApprovalCenter} onNavigate={onNavigate} />

    {error ? <div className="nexus-command__alert dashboard-data-error" role="alert"><strong>ข้อมูลไม่พร้อมใช้งาน</strong><span>โหลดภาพรวมไม่สำเร็จ ระบบไม่สร้างข้อมูลแทน</span><RequestErrorReference requestId={typeof error === 'string' ? undefined : error?.requestId} /></div> : partialErrors.length > 0 ? <div className="nexus-command__alert dashboard-data-warning" role="status"><strong>ข้อมูลบางส่วนไม่พร้อม</strong><span>ข้อมูลพร้อมแสดงตามสิทธิ์</span></div> : null}

    <section className="nexus-command__grid dashboard-command-grid">
      <article className="nexus-stream nexus-panel">
        <header><div><p className="nexus-kicker">รายการสำคัญ</p><h2>รายการที่ต้องดำเนินการ</h2></div></header>
        <div className="nexus-stream__list">{loading ? <div className="nexus-loading">กำลังอ่านข้อมูล…</div> : attentionActions.length ? attentionActions.slice(0,5).map((row) => <button type="button" className="nexus-stream__item" key={row.key} onClick={() => onNavigate(row.page)} aria-label={row.title}><span className="nexus-stream__pulse"/><div><strong>{row.title}</strong><small>{row.severity === 'urgent' ? 'เร่งดำเนินการ' : row.severity === 'warning' ? 'ติดตามตามกำหนด' : 'ตรวจสอบต่อได้ทันที'}</small></div><i aria-hidden="true">›</i></button>) : <div className="nexus-clear"><SmsIcon name="check" size={28}/><strong>ไม่มีรายการค้าง</strong><span>ไม่มีงานเร่งด่วน</span></div>}</div>
      </article>
    </section>

    <section className="nexus-kpis" aria-label="ตัวชี้วัด">
      <button type="button" onClick={() => onNavigate('employees')}><span>พนักงานปฏิบัติงาน</span><strong>{numberText(active)}<small> / {numberText(total)}</small></strong><em>{total ? Math.round(active/total*100) : 0}% พร้อมทำงาน</em></button>
      <button type="button" onClick={() => onNavigate('schedule')}><span>ทำงานวันนี้</span><strong>{numberText(onDuty)}</strong><em>ตามตารางกะ</em></button>
      <button type="button" onClick={() => onNavigate('leave')}><span>ลาวันนี้</span><strong>{numberText(leave)}</strong><em>บุคลากรที่ลาในวันที่เลือก</em></button>
      <button type="button" onClick={() => onNavigate('licenses')}><span>ใบอนุญาตใกล้หมดอายุ</span><strong>{numberText(expiring)}</strong><em>{expiring ? 'ควรตรวจสอบ' : 'ไม่มีรายการใกล้หมดอายุ'}</em></button>
    </section>

    <section className="nexus-legacy-data" aria-label="รายละเอียด">
      <div className="nexus-section-heading"><div><p className="nexus-kicker">ข้อมูลที่ตรวจสอบแล้ว</p><h2>ข้อมูลปฏิบัติการ</h2></div><span>ข้อมูลจากระบบ</span></div>
      <div className="dashboard-command-grid dashboard-primary-grid"><TodayOperationsCard operations={todayOperations} loading={loading} onNavigate={onNavigate} /></div>
      <QuickActionsCard canManage={canManage} onNavigate={onNavigate} />
      <div className="dashboard-secondary-grid"><LeaveSummaryCard summary={leaveOverview} loading={loading} canManage={canManage} canAdmin={canAdmin} onNavigate={onNavigate} /><LicenseSummaryCard summary={licenseSummary} overview={licenseOverview} loading={loading} onNavigate={onNavigate} /></div>
      <div className="dashboard-tertiary-grid"><DataSyncStatusCard generatedAt={generatedAt} /></div>
    </section>

    <section className="nexus-lower-grid">
      <article className="nexus-panel nexus-activity"><header><div><p className="nexus-kicker">กิจกรรมที่บันทึก</p><h2>กิจกรรมล่าสุด</h2></div><span className="nexus-state">อ่านอย่างเดียว</span></header><div>{activities.length ? activities.slice(0,4).map((row,index)=><p key={String((row as any).id||index)}><i/><span><strong>{String((row as any).title || (row as any).action || 'กิจกรรมในระบบ')}</strong><small>{String((row as any).description || (row as any).detail || '')}</small></span></p>) : <p className="nexus-activity__empty"><span><strong>ไม่มีกิจกรรมล่าสุด</strong><small>ไม่มีกิจกรรมจากข้อมูลปัจจุบัน</small></span></p>}</div></article>
    </section>
  </section>;
}
