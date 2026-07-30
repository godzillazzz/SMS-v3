type Props = { page: number; totalPages: number; onChange(page: number): void };
export function PersonnelPagination({ page, totalPages, onChange }: Props) {
  if (totalPages <= 1) return null;
  return <nav className="personnel-pagination" aria-label="แบ่งหน้าบุคลากร"><button type="button" disabled={page === 1} onClick={() => onChange(page - 1)}>‹</button><span>หน้า {page} / {totalPages}</span><button type="button" disabled={page === totalPages} onClick={() => onChange(page + 1)}>›</button></nav>;
}
