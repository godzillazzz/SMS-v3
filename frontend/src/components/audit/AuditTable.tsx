import type { AuditEvent } from './audit-types';
import { actionLabel, entityLabel, eventLabel, formatAuditTime, metadataSummary, moduleLabel, safe, safeMetadataEntries } from './audit-utils';

type Props = { rows: AuditEvent[]; selected?: AuditEvent; onSelect(row: AuditEvent): void; loading: boolean; hasActiveFilters: boolean };

const compactMetadataValue = (value: string) => value.length > 34 ? `${value.slice(0, 18)}…${value.slice(-8)}` : value;

function mobileMetadataSummary(metadata: AuditEvent['metadata']) {
  const entries = safeMetadataEntries(metadata);
  const requestId = entries.find(([key]) => key.toLowerCase() === 'requestid');
  const [key, value] = requestId || entries[0] || [];
  return key && value ? `${key}: ${compactMetadataValue(value)}` : 'ไม่มีรายละเอียดเพิ่มเติม';
}

function AuditMobileCards({ rows, selected, onSelect, loading, hasActiveFilters }: Props) {
  if (loading) return <div className="audit-mobile-cards" aria-label="กำลังโหลดรายการ Audit Log">{Array.from({ length: 3 }, (_, index) => <article key={`mobile-skeleton-${index}`} className="audit-mobile-card audit-mobile-skeleton" aria-hidden="true"><span /><span /><span /></article>)}</div>;
  if (!rows.length) return <div className="audit-mobile-empty data-state data-state--empty"><span aria-hidden="true">⌁</span><strong>ไม่พบรายการ Audit Log ตามเงื่อนไขที่เลือก</strong><p>{hasActiveFilters ? 'ลองเปลี่ยนตัวกรองหรือขยายช่วงวันที่' : 'ยังไม่มีบันทึกที่แสดงในมุมมองนี้'}</p></div>;

  return <div className="audit-mobile-cards" aria-label="รายการ Audit Log">
    {rows.map((row, index) => <article key={safe(row.id, `mobile-event-${index}`)} className={`audit-mobile-card data-mobile-card ${selected === row ? 'is-selected' : ''}`}>
      <header>
        <time>{formatAuditTime(row.createdAt)}</time>
        <span className="audit-role-badge">{safe(row.actor?.role, 'ไม่ระบุบทบาท')}</span>
      </header>
      <div className="audit-mobile-actor">
        <span className="audit-mobile-label">ผู้ดำเนินการ</span>
        <strong>{safe(row.actor?.displayName, 'Unknown / Deleted User')}</strong>
      </div>
      <div className="audit-mobile-facts">
        <div><span className="audit-mobile-label">Module</span><span className="audit-module-badge">{moduleLabel(row.module)}</span></div>
        <div><span className="audit-mobile-label">Action</span><span className="audit-action-badge">{actionLabel(row.action)}</span></div>
      </div>
      <div className="audit-mobile-target"><span className="audit-mobile-label">ข้อมูลเป้าหมาย</span><strong>{entityLabel(row.entityType)}</strong><small className="audit-entity-id">{safe(row.entityId)}</small></div>
      <div className="audit-mobile-summary"><span className="audit-mobile-label">รายละเอียดสั้น</span><p>{mobileMetadataSummary(row.metadata)}</p></div>
      <footer><small>{eventLabel(row)}</small><button type="button" className="audit-preview-link" onClick={() => onSelect(row)}>ดูรายละเอียด</button></footer>
    </article>)}
  </div>;
}

export function AuditTable({ rows, selected, onSelect, loading, hasActiveFilters }: Props) {
  return <div className="audit-table-card data-surface-card">
    <div className="audit-desktop-table"><div className="audit-table-scroll data-table-scroll"><table className="audit-table data-surface-table"><thead><tr><th scope="col">วันและเวลา</th><th scope="col">ผู้ดำเนินการ</th><th scope="col">Module</th><th scope="col">การดำเนินการ</th><th scope="col">ข้อมูลเป้าหมาย</th><th scope="col">รายละเอียด</th></tr></thead><tbody>{loading ? Array.from({ length: 5 }, (_, index) => <tr key={`skeleton-${index}`} className="audit-skeleton-row"><td colSpan={6}><span /></td></tr>) : rows.length ? rows.map((row, index) => <tr key={safe(row.id, `event-${index}`)} className={selected === row ? 'is-selected' : ''} tabIndex={0} onClick={() => onSelect(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(row); } }}><td>{formatAuditTime(row.createdAt)}</td><td><strong>{safe(row.actor?.displayName, 'Unknown / Deleted User')}</strong><small>{safe(row.actor?.role, 'ไม่ระบุบทบาท')}</small></td><td><span className="audit-module-badge">{moduleLabel(row.module)}</span></td><td><span className="audit-action-badge">{actionLabel(row.action)}</span><small>{eventLabel(row)}</small></td><td><strong>{entityLabel(row.entityType)}</strong><small className="audit-entity-id">{safe(row.entityId)}</small></td><td><span className="audit-row-summary">{metadataSummary(row.metadata)}</span><button type="button" className="audit-preview-link" onClick={(event) => { event.stopPropagation(); onSelect(row); }}>ดูรายละเอียด</button></td></tr>) : <tr><td colSpan={6} className="audit-no-rows data-table-empty-cell"><span aria-hidden="true">⌁</span><strong>ไม่พบรายการ Audit Log ตามเงื่อนไขที่เลือก</strong><p>{hasActiveFilters ? 'ลองเปลี่ยนตัวกรองหรือขยายช่วงวันที่' : 'ยังไม่มีบันทึกที่แสดงในมุมมองนี้'}</p></td></tr>}</tbody></table></div></div>
    <AuditMobileCards rows={rows} selected={selected} onSelect={onSelect} loading={loading} hasActiveFilters={hasActiveFilters} />
  </div>;
}

export type { AuditEvent } from './audit-types';
