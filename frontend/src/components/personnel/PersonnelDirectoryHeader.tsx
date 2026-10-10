import { PageHeader } from '../layout';
import { SmsIcon } from '../SmsIcon';

type Props = { canManage: boolean; canReviewChanges?: boolean; totalCount?: number; onAdd(): void; onReviewChanges?(): void; onRefresh(): void };
export function PersonnelDirectoryHeader({ canManage, canReviewChanges = false, totalCount, onAdd, onReviewChanges, onRefresh }: Props) {
  return <PageHeader className="personnel-directory-header" kicker="บุคลากรและสิทธิ์" title="ข้อมูลพนักงาน" description="ค้นหา ตรวจสอบ และจัดการข้อมูลบุคลากรตามสิทธิ์ที่ได้รับ" actions={<div className="personnel-header-actions"><span className="personnel-result-support">ทั้งหมด {totalCount ?? '—'} คน</span><button type="button" className="btn-neutral small-action personnel-utility-action" onClick={onRefresh}><SmsIcon name="refresh" size={17} />รีเฟรช</button>{canReviewChanges && <button type="button" className="btn-neutral small-action personnel-review-action" onClick={onReviewChanges}><SmsIcon name="approval" size={17} />คำขอแก้ไข</button>}{canManage && <button type="button" className="btn-primary compact personnel-primary-action" onClick={onAdd}><SmsIcon name="plus" size={17} />เพิ่มพนักงาน</button>}</div>} />;
}
