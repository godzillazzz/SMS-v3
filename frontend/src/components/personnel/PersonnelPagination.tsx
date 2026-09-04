import { DataTablePagination } from '../ResponsiveDataTable';

type Props = { page: number; totalPages: number; onChange(page: number): void };
export function PersonnelPagination({ page, totalPages, onChange }: Props) {
  return <DataTablePagination page={page} totalPages={totalPages} onChange={onChange} ariaLabel="แบ่งหน้าบุคลากร" className="personnel-pagination" />;
}
