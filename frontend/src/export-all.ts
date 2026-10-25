type PageResponse = { data?: unknown; meta?: { totalPages?: number | string } };
type Row = Record<string, unknown>;

/* Export every page of a list with a hard cap so a long audit/history can never fan out into hundreds of requests (audit X-08). */
export const EXPORT_MAX_PAGES = 25;
export async function loadAllPagesCapped(loadPage: (page: number) => Promise<PageResponse>, maxPages = EXPORT_MAX_PAGES) {
  const first = await loadPage(1);
  const totalPages = Math.max(1, Number(first.meta?.totalPages) || 1);
  const lastPage = Math.min(totalPages, maxPages);
  const responses = [first];
  for (let start = 2; start <= lastPage; start += 4) {
    const pages = Array.from({ length: Math.min(4, lastPage - start + 1) }, (_, index) => start + index);
    responses.push(...await Promise.all(pages.map(loadPage)));
  }
  const rows = responses.flatMap((response) => Array.isArray(response.data) ? response.data as Row[] : []);
  return { rows, truncated: totalPages > lastPage, totalPages, loadedPages: lastPage };
}

