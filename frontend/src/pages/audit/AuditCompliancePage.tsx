import { useState } from 'react';
import { AuditEventPreview } from '../../components/audit/AuditEventPreview';
import { AuditPageHeader } from '../../components/audit/AuditPageHeader';
import { AuditSummaryGrid } from '../../components/audit/AuditSummaryGrid';
import { AuditTable } from '../../components/audit/AuditTable';
import { AuditToolbar } from '../../components/audit/AuditToolbar';
import type { AuditEvent, AuditFilters } from '../../components/audit/audit-types';
import { summarizeAuditEvents } from '../../components/audit/audit-utils';
import '../../styles/audit-compliance.css';
import '../../styles/audit-mobile.css';

type Props = { rows: AuditEvent[]; total: number; page?: number; totalPages?: number; pageSize?: number; loading: boolean; error?: string; permissionDenied?: boolean; filters: AuditFilters; onFiltersChange(filters: AuditFilters): void; onRefresh(): void; onPageChange(page: number): void; onPageSize(value: number): void; onExport(rows: AuditEvent[]): void; onPrint(): void };

export function AuditCompliancePage({ rows, total, page = 1, totalPages = 1, pageSize = 25, loading, error, permissionDenied, filters, onFiltersChange, onRefresh, onPageChange, onPageSize, onExport, onPrint }: Props) {
  const [selected, setSelected] = useState<AuditEvent>();
  const { categories, actors } = summarizeAuditEvents(rows);
  const hasActiveFilters = Object.entries(filters).some(([key, value]) => key === 'category' ? value !== 'default' : Boolean(value));
  return <section className="audit-compliance-page" aria-label="บันทึกการใช้งานระบบ"><AuditPageHeader total={total} onRefresh={onRefresh} onExport={() => onExport(rows)} onPrint={onPrint} authorized={!permissionDenied} loading={loading} hasError={Boolean(error)} hasRows={rows.length > 0} />{!permissionDenied && !error && <AuditSummaryGrid total={total} pageCount={rows.length} categories={categories} actors={actors} loading={loading} />}{permissionDenied ? <div className="audit-state audit-state--permission"><span aria-hidden="true">⛨</span><h2>ไม่มีสิทธิ์เข้าถึงบันทึกการใช้งานระบบ</h2><p>เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดู Audit Log ได้</p></div> : error ? <div className="audit-state"><span aria-hidden="true">!</span><h2>ไม่สามารถโหลดบันทึกการใช้งานระบบ</h2><p>ระบบไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง</p><button type="button" className="btn-neutral small-action" onClick={onRefresh}>ลองใหม่</button></div> : <><AuditToolbar pageSize={pageSize} onPageSize={onPageSize} filters={filters} onFiltersChange={onFiltersChange} onClear={() => onFiltersChange({ dateFrom: '', dateTo: '', actor: '', entityType: '', action: '', search: '', category: 'default' })} /><AuditTable rows={rows} selected={selected} onSelect={setSelected} loading={loading} hasActiveFilters={hasActiveFilters} />{totalPages > 1 && <div className="audit-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>‹ ก่อนหน้า</button><span>หน้า {page} จาก {totalPages}</span><button type="button" disabled={page >= totalPages || loading} onClick={() => onPageChange(page + 1)}>หน้าถัดไป ›</button></div>}</>}<AuditEventPreview event={selected} onClose={() => setSelected(undefined)} /></section>;
}
