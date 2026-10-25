import { describe, expect, it, vi } from 'vitest';



describe('capped all-pages export (audit X-08)', () => {
  it('loads every page when under the cap', async () => {
    const { loadAllPagesCapped } = await import('./export-all');
    const load = vi.fn(async (page: number) => ({ data: [{ id: page }], meta: { totalPages: 3 } }));
    const result = await loadAllPagesCapped(load);
    expect(result.rows.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(result.truncated).toBe(false);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('stops at the cap and reports truncation instead of fanning out', async () => {
    const { loadAllPagesCapped } = await import('./export-all');
    const load = vi.fn(async (page: number) => ({ data: [{ id: page }], meta: { totalPages: 900 } }));
    const result = await loadAllPagesCapped(load, 25);
    expect(load).toHaveBeenCalledTimes(25);
    expect(result.truncated).toBe(true);
    expect(result.loadedPages).toBe(25);
  });
});
