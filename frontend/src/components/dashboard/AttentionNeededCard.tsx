import { formatMetric, type DashboardAction, type DashboardExpiringLicense, type DashboardNavigate } from './types';

type AttentionNeededCardProps = { rows: DashboardAction[]; expiringLicenses: DashboardExpiringLicense[]; expiringCount: number; loading: boolean; onNavigate: DashboardNavigate };

function actionQuery(key: string): Record<string, string> | undefined {
  if (key === 'licensePending' || key === 'licenseReturned' || key === 'licenseExpired') {
    const status = key === 'licensePending' ? 'PENDING' : key === 'licenseReturned' ? 'RETURNED_FOR_CORRECTION' : 'EXPIRED';
    return { metric: 'licenseStatus', status };
  }
  if (key === 'licenseExpiring') return { metric: 'licenseExpiry', expiryBucket: 'EXPIRING_0_30' };
  if (key === 'pendingLeaves') return { metric: 'pendingLeaves' };
  if (key === 'pendingUsers') return { metric: 'pendingUsers' };
  if (key === 'missingSchedule') return { metric: 'schedule', workforce: 'NO_SHIFT' };
  if (key === 'unmatchedQuota') return { metric: 'unmatchedQuota' };
  return undefined;
}

const expiryDateFormatter = new Intl.DateTimeFormat('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
const expiryText = (row: DashboardExpiringLicense) => row.daysRemaining < 0 ? 'หมดอายุแล้ว ' + formatMetric(Math.abs(row.daysRemaining)) + ' วัน' : 'เหลือ ' + formatMetric(row.daysRemaining) + ' วัน';
const expiryLabel = (row: DashboardExpiringLicense) => row.employeeName + ' ' + expiryText(row);

export function AttentionNeededCard({ rows, expiringLicenses, expiringCount, loading, onNavigate }: AttentionNeededCardProps) {
  const visibleRows = rows.filter((row) => row.count > 0);
  const hasContent = visibleRows.length > 0 || expiringLicenses.length > 0;
  return <section className="dashboard-panel dashboard-attention" aria-label="Action Center">
    <header className="dashboard-panel__header"><div><h2>ศูนย์ดำเนินการ</h2><span>รายการที่ควรติดตามและดำเนินการ</span></div><span className={'dashboard-attention__count ' + (visibleRows.length ? '' : 'is-clear')}>{visibleRows.length ? formatMetric(visibleRows.length) + ' กลุ่มงาน' : 'ปกติดี'}</span></header>
    {loading ? <div className="dashboard-list-skeleton"><span /><span /><span /></div> : hasContent ? <>
      {visibleRows.length > 0 && <div className="dashboard-attention__list">{visibleRows.map((row) => <button type="button" className="btn-ghost dashboard-attention-row" key={row.key} onClick={() => { const query = actionQuery(row.key); if (query) onNavigate('dashboardDetails', query); else onNavigate(row.page); }} aria-label={row.title + ' ' + formatMetric(row.count) + ' รายการ'}><span className={'dashboard-attention-row__icon dashboard-attention-row__icon--' + row.severity} aria-hidden="true">!</span><span><b>{row.title}</b><small>{row.severity === 'urgent' ? 'เร่งดำเนินการ' : row.severity === 'warning' ? 'ติดตามตามกำหนด' : 'ตรวจสอบต่อได้ทันที'}</small></span><em>{formatMetric(row.count)}</em><i aria-hidden="true">›</i></button>)}</div>}
      {expiringLicenses.length > 0 && <div className="dashboard-expiring-list" aria-label="รายชื่อใบอนุญาตใกล้หมดอายุ"><div className="dashboard-expiring-list__header"><b>ใบอนุญาตใกล้หมดอายุ</b><button type="button" className="dashboard-link-button" onClick={() => onNavigate('dashboardDetails', { metric: 'licenseExpiry', expiryBucket: 'EXPIRING_0_30' })} aria-label={'ดูใบอนุญาตใกล้หมดอายุทั้งหมด ' + formatMetric(expiringCount) + ' รายการ'}>ดูทั้งหมด ({formatMetric(expiringCount)})</button></div>{expiringLicenses.slice(0, 5).map((row) => <button type="button" className="dashboard-expiring-row" key={row.licenseId} onClick={() => onNavigate('dashboardDetails', { metric: 'licenseExpiry', expiryBucket: 'EXPIRING_0_30', licenseId: row.licenseId })} aria-label={expiryLabel(row) + ' เปิดรายละเอียดใบอนุญาต'}><span className={'dashboard-expiring-row__indicator dashboard-expiring-row__indicator--' + row.urgency} aria-hidden="true">!</span><span className="dashboard-expiring-row__person"><b>{row.employeeName || 'ไม่ระบุชื่อ'}</b><small>{row.employeeCode || 'ไม่ระบุรหัส'} · หมดอายุ {expiryDateFormatter.format(new Date(row.expiryDate))}</small></span><span className={'dashboard-expiring-row__remaining dashboard-expiring-row__remaining--' + row.urgency}>{expiryText(row)}</span><i aria-hidden="true">›</i></button>)}</div>}
    </> : <div className="dashboard-empty-inline"><span>✓</span><div><b>ไม่มีรายการที่ต้องติดตาม</b><small>ไม่มีใบอนุญาตใกล้หมดอายุหรือรายการสำคัญที่ต้องดำเนินการในขณะนี้</small></div></div>}
  </section>;
}
