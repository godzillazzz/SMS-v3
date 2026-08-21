import { SmsIcon } from '../SmsIcon';

type Props = { canManage: boolean; canReviewChanges?: boolean; totalCount: number; onAdd(): void; onReviewChanges?(): void; onRefresh(): void };
export function PersonnelDirectoryHeader({ canManage, canReviewChanges = false, totalCount, onAdd, onReviewChanges, onRefresh }: Props) {
  return <header className="personnel-directory-header"><div><h1>ข้อมูลพนักงาน</h1><p>ค้นหา ตรวจสอบ และจัดการข้อมูลบุคลากรตามสิทธิ์ที่ได้รับ</p></div><div className="personnel-header-actions"><span className="personnel-result-support">ทั้งหมด {totalCount} คน</span><button type="button" className="btn-neutral small-action personnel-utility-action" onClick={onRefresh}><SmsIcon name="refresh" size={17} />รีเฟรช</button>{canReviewChanges && <button type="button" className="btn-neutral small-action personnel-review-action" onClick={onReviewChanges}><SmsIcon name="approval" size={17} />คำขอแก้ไข</button>}{canManage && <button type="button" className="btn-primary compact personnel-primary-action" onClick={onAdd}><SmsIcon name="plus" size={17} />เพิ่มพนักงาน</button>}</div></header>;
}
