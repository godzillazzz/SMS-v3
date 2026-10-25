import { Button } from '../ui/primitives';

type Props = { total: number; onRefresh(): void; onExport(): void; onPrint(): void; authorized: boolean; loading: boolean; hasError: boolean; hasRows: boolean };
export function AuditPageHeader({ total, onRefresh, onExport, onPrint, authorized, loading, hasError, hasRows }: Props) {
  const exportEnabled = authorized && !loading && !hasError && hasRows;
  return <header className="audit-page-header"><div><p className="audit-eyebrow">GOVERNANCE · COMPLIANCE</p><h1>บันทึกการตรวจสอบและการกำกับดูแล</h1><p>ตรวจสอบกิจกรรมของระบบและเหตุการณ์ด้านการบริหารสิทธิ์จากข้อมูลที่ได้รับอนุญาต</p></div>{authorized && <div className="audit-header-actions"><span className="audit-result-support">ทั้งหมด {total} รายการ</span><Button type="button" variant="neutral" size="small" onClick={onRefresh} disabled={loading}>↻ รีเฟรช</Button><Button type="button" variant="info-outline" size="small" onClick={onExport} disabled={!exportEnabled}>⇧ CSV</Button><Button type="button" variant="info-soft" size="small" onClick={onPrint} disabled={!exportEnabled}>พิมพ์ / PDF</Button></div>}</header>;
}
