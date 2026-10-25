import { useMemo, useState } from 'react';
import { AuditEventPreview } from '../../components/audit/AuditEventPreview';
import { AuditPageHeader } from '../../components/audit/AuditPageHeader';
import { AuditSummaryGrid } from '../../components/audit/AuditSummaryGrid';
import { AuditTable, type AuditEvent } from '../../components/audit/AuditTable';
import { AuditToolbar } from '../../components/audit/AuditToolbar';
import { Button, EmptyState, Pagination } from '../../components/ui/primitives';
import { filterAuditEvents, summarizeAuditEvents } from '../../components/audit/audit-utils';
import '../../styles/audit-compliance.css';

type Props = { rows: AuditEvent[]; total: number; page?: number; totalPages?: number; pageSize?: number; loading: boolean; error?: string; permissionDenied?: boolean; onRefresh(): void; onPageChange(page: number): void; onPageSize(value: number): void; onExport(rows: AuditEvent[]): void; onPrint(): void };

export function AuditCompliancePage({ rows, total, page = 1, totalPages = 1, pageSize = 100, loading, error, permissionDenied, onRefresh, onPageChange, onPageSize, onExport, onPrint }: Props) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AuditEvent>();
  const filtered = useMemo(() => filterAuditEvents(rows, search), [rows, search]);
  const { categories, actors } = summarizeAuditEvents(rows);

  return <section className="audit-compliance-page" aria-label="Audit and Compliance">
    <AuditPageHeader total={total} onRefresh={onRefresh} onExport={() => onExport(filtered)} onPrint={onPrint} authorized={!permissionDenied} loading={loading} hasError={Boolean(error)} hasRows={rows.length > 0} />
    {!permissionDenied && !error && <AuditSummaryGrid total={total} pageCount={rows.length} categories={categories} actors={actors} loading={loading} />}
    {permissionDenied ? <EmptyState icon="⛨" title="ไม่มีสิทธิ์เข้าถึงบันทึกการตรวจสอบ" description="บัญชีนี้ไม่ได้รับอนุญาตให้ดูข้อมูล Audit & Compliance" className="audit-state audit-state--permission" /> : error ? <EmptyState icon="!" title="ไม่สามารถโหลดบันทึกการตรวจสอบ" description="ระบบไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง" className="audit-state" role="alert" aria-live="assertive">
      <Button type="button" variant="neutral" size="small" onClick={onRefresh}>ลองใหม่</Button>
    </EmptyState> : <>
      <AuditToolbar pageSize={pageSize} onPageSize={onPageSize} search={search} onSearch={setSearch} onClear={() => setSearch('')} active={Boolean(search)} />
      <AuditTable rows={rows} selected={selected} onSelect={setSelected} loading={loading} search={search} />
      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onChange={onPageChange} label="แบ่งหน้าบันทึกการตรวจสอบ" previousLabel="‹ ก่อนหน้า" nextLabel="หน้าถัดไป ›" pageLabel={(current, totalPageCount) => `หน้า ${current} จาก ${totalPageCount}`} disabled={loading} className="audit-pagination" />}
    </>}
    <AuditEventPreview event={selected} onClose={() => setSelected(undefined)} />
  </section>;
}
