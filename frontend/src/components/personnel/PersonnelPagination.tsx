type Props = { page: number; totalPages: number; onChange(page: number): void };
import { Pagination } from '../ui/primitives';

export function PersonnelPagination({ page, totalPages, onChange }: Props) {
  return <Pagination page={page} totalPages={totalPages} onChange={onChange} label="แบ่งหน้าบุคลากร" previousLabel="‹" nextLabel="›" pageLabel={(current, total) => `หน้า ${current} / ${total}`} className="personnel-pagination" />;
}
