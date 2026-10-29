export type PrintLeave = { id: string; employeeId: string; leaveTypeNameSnapshot?: string; leaveType?: string; startDate?: string; endDate?: string; dayCount?: number; status?: string };

type Page = { data?: unknown; meta?: { totalPages?: number } };
export async function loadEmployeePrintLeaves(fetchPage: (token: string, page: number, filters: { employeeId: string }) => Promise<Page>, token: string, employeeId: string, year: number): Promise<PrintLeave[]> {
  const rows: PrintLeave[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    const result = await fetchPage(token, page, { employeeId });
    if (!Array.isArray(result.data) || !Number.isInteger(result.meta?.totalPages) || (result.meta?.totalPages as number) < 0 || (result.meta?.totalPages as number) > 1000) throw new Error('Invalid leave response');
    totalPages = Math.max(1, result.meta!.totalPages!);
    for (const value of result.data) {
      const row = value as PrintLeave;
      if (!row || row.employeeId !== employeeId || typeof row.startDate !== 'string' || typeof row.endDate !== 'string' || Number.isNaN(Date.parse(row.startDate)) || Number.isNaN(Date.parse(row.endDate))) throw new Error('Invalid leave record');
      if (row.startDate.slice(0, 10) < `${year + 1}-01-01` && row.endDate.slice(0, 10) >= `${year}-01-01`) rows.push(row);
    }
  }
  return rows.slice(0, 100);
}
