import { Button } from '../ui/primitives';

type Props = { canManage: boolean; totalCount: number; onAdd(): void; onRefresh(): void };
export function PersonnelDirectoryHeader({ canManage, totalCount, onAdd, onRefresh }: Props) {
  return <header className="personnel-directory-header"><div><p className="personnel-eyebrow">PEOPLE · PERSONNEL OPERATIONS</p><h1>Personnel Directory</h1><p>ค้นหา ตรวจสอบ และจัดการข้อมูลบุคลากรจากฐานข้อมูลกลาง</p></div><div className="personnel-header-actions"><Button type="button" variant="neutral" size="small" onClick={onRefresh}>↻ รีเฟรช</Button>{canManage && <Button type="button" variant="primary" size="compact" onClick={onAdd}>+ เพิ่มพนักงาน</Button>}<span className="personnel-result-support">ทั้งหมด {totalCount} คน</span></div></header>;
}
