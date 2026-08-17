type Props = { page: number; totalPages: number; onChange(page: number): void };
export function PersonnelPagination({ page, totalPages, onChange }: Props) {
  if (totalPages <= 1) return null;
  return <nav className="personnel-pagination data-pagination" aria-label="แบ่งหน้าบุคลากร"><button type="button" aria-label="หน้าก่อนหน้า" disabled={page === 1} onClick={() => onChange(page - 1)}>‹</button><span>หน้า {page} จาก {totalPages}</span><button type="button" aria-label="หน้าถัดไป" disabled={page === totalPages} onClick={() => onChange(page + 1)}>›</button></nav>;
}
