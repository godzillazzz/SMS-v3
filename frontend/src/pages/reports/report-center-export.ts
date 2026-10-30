export const EMPLOYEE_PAGE_SIZE = 100;
const MAX_EXPORT_PAGES = 50;

type PagedResponse<T> = { data?: unknown; meta?: { totalPages?: unknown } };

export async function collectAllPages<T>(load: (pageNumber: number) => Promise<PagedResponse<T>>): Promise<T[]> {
  const rows: T[] = [];
  let totalPages = 1;
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
    const result = await load(pageNumber);
    const pages = Number(result?.meta?.totalPages);
    if (!Array.isArray(result?.data) || !Number.isInteger(pages)) throw new Error('invalid pagination');
    rows.push(...(result.data as T[]));
    totalPages = Math.min(MAX_EXPORT_PAGES, Math.max(1, pages));
  }
  return rows;
}

export function bangkokTodayText(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Month-print reports run from day 1 to the returned date; null means the month has not started yet. */
export function monthPrintTargetDate(year: number, month: number, todayText = bangkokTodayText()): string | null {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const todayMonth = todayText.slice(0, 7);
  if (monthKey > todayMonth) return null;
  if (monthKey === todayMonth) return todayText;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${monthKey}-${String(lastDay).padStart(2, '0')}`;
}
