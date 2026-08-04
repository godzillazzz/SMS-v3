import { formatMetric, type DashboardAction, type DashboardExpiringLicense, type DashboardNavigate } from './types';

type AttentionNeededCardProps = { rows: DashboardAction[]; expiringLicenses: DashboardExpiringLicense[]; loading: boolean; onNavigate: DashboardNavigate };

const expiryDateFormatter = new Intl.DateTimeFormat('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
const expiryText = (row: DashboardExpiringLicense) => row.daysRemaining < 0 ? `หมดอายุแล้ว ${formatMetric(Math.abs(row.daysRemaining))} วัน` : `เหลือ ${formatMetric(row.daysRemaining)} วัน`;
const expiryLabel = (row: DashboardExpiringLicense) => `${row.employeeName} ${expiryText(row)}`;

export function AttentionNeededCard({ rows, expiringLicenses, loading, onNavigate }: AttentionNeededCardProps) {
  const hasContent = rows.length > 0 || expiringLicenses.length > 0;
  return <section className="dashboard-panel dashboard-attention">
    <header className="dashboard-panel__header"><div><p>ATTENTION NEEDED</p><h2>รายการที่ต้องติดตาม</h2></div><span className={`dashboard-attention__count ${rows.length ? '' : 'is-clear'}`}>{rows.length ? `${rows.length} กลุ่มรายการ` : 'ปกติดี'}</span></header>
    {loading ? <div className="dashboard-list-skeleton"><span /><span /><span /></div> : hasContent ? <>
      {rows.length > 0 && <div className="dashboard-attention__list">{rows.map((row) => <button className="btn-ghost dashboard-attention-row" key={row.key} onClick={() => onNavigate(row.page)} aria-label={`${row.title} ${formatMetric(row.count)} รายการ`}><span className={`dashboard-attention-row__icon dashboard-attention-row__icon--${row.severity}`} aria-hidden="true">!</span><span><b>{row.title}</b><small>{row.severity === 'urgent' ? 'เร่งดำเนินการ' : row.severity === 'warning' ? 'ติดตามตามกำหนด' : 'ตรวจสอบต่อได้ทันที'}</small></span><em>{formatMetric(row.count)}</em><i aria-hidden="true">›</i></button>)}</div>}
      {expiringLicenses.length > 0 && <div className="dashboard-expiring-list" aria-label="รายชื่อใบอนุญาตใกล้หมดอายุ"><div className="dashboard-expiring-list__header"><b>ใบอนุญาตใกล้หมดอายุ</b><button type="button" className="dashboard-link-button" onClick={() => onNavigate('licenses')} aria-label={`ดูใบอนุญาตใกล้หมดอายุทั้งหมด ${formatMetric(expiringLicenses.length)} รายการ`}>ดูทั้งหมด ({formatMetric(expiringLicenses.length)})</button></div>{expiringLicenses.slice(0, 5).map((row) => <button type="button" className="dashboard-expiring-row" key={row.licenseId} onClick={() => onNavigate('licenses')} aria-label={`${expiryLabel(row)} เปิดหน้าใบอนุญาต`}><span className={`dashboard-expiring-row__indicator dashboard-expiring-row__indicator--${row.urgency}`} aria-hidden="true">!</span><span className="dashboard-expiring-row__person"><b>{row.employeeName || 'ไม่ระบุชื่อ'}</b><small>{row.employeeCode || 'ไม่ระบุรหัส'} · หมดอายุ {expiryDateFormatter.format(new Date(row.expiryDate))}</small></span><span className={`dashboard-expiring-row__remaining dashboard-expiring-row__remaining--${row.urgency}`}>{expiryText(row)}</span><i aria-hidden="true">›</i></button>)}</div>}
    </> : <div className="dashboard-empty-inline"><span>✓</span><div><b>ไม่มีรายการที่ต้องติดตาม</b><small>ไม่มีใบอนุญาตใกล้หมดอายุหรือรายการสำคัญที่ต้องดำเนินการในขณะนี้</small></div></div>}
  </section>;
}
