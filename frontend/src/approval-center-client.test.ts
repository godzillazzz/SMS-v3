// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { getApprovalCenter, getApprovalCenterSummary, invalidateApprovalCenter, invalidateApprovalCenterSummary } from './approval-center-client';
afterEach(() => { invalidateApprovalCenter(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('shares concurrent and near-concurrent reads, then invalidates after mutation', async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ summary: { total: 1 } }) }));
  vi.stubGlobal('fetch', fetcher);
  await Promise.all([getApprovalCenterSummary('a'), getApprovalCenterSummary('a')]);
  await getApprovalCenterSummary('a');
  expect(fetcher).toHaveBeenCalledTimes(1);
  invalidateApprovalCenterSummary();
  await getApprovalCenterSummary('a');
  expect(fetcher).toHaveBeenCalledTimes(2);
  await getApprovalCenterSummary('b');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('force refresh discards an older in-flight generation', async () => {
  let finish!: (value: unknown) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ ok: true, json: async () => ({ summary: { total: 2 } }) });
  vi.stubGlobal('fetch', fetcher);
  const old = getApprovalCenterSummary('a');
  await getApprovalCenterSummary('a', { forceRefresh: true });
  finish({ ok: true, json: async () => ({ summary: { total: 1 } }) });
  expect((await old).summary.total).toBe(2);
  expect((await getApprovalCenterSummary('a')).summary.total).toBe(2);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('expires the short cache and does not cache rejected requests', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(100);
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ summary: { total: 1 } }) });
  vi.stubGlobal('fetch', fetcher);
  await getApprovalCenterSummary('a');
  now.mockReturnValue(2101);
  await getApprovalCenterSummary('a');
  expect(fetcher).toHaveBeenCalledTimes(2);
  invalidateApprovalCenterSummary();
  fetcher.mockResolvedValueOnce({ ok: false, status: 403, headers: new Headers(), json: async () => ({ error: 'forbidden' }) });
  await expect(getApprovalCenterSummary('a')).rejects.toThrow('forbidden');
  await getApprovalCenterSummary('a');
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('deduplicates list reads by auth scope through expiry and invalidation', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(100);
  let finish!: (value: unknown) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ ok: true, json: async () => ({ data: ['cached'] }) });
  vi.stubGlobal('fetch', fetcher);
  const first = getApprovalCenter('a');
  const second = getApprovalCenter('a');
  expect(fetcher).toHaveBeenCalledTimes(1);
  finish({ ok: true, json: async () => ({ data: ['first'] }) });
  await expect(Promise.all([first, second])).resolves.toEqual([{ data: ['first'] }, { data: ['first'] }]);
  await getApprovalCenter('a');
  expect(fetcher).toHaveBeenCalledTimes(1);
  await getApprovalCenter('b');
  expect(fetcher).toHaveBeenCalledTimes(2);
  now.mockReturnValue(2101);
  await getApprovalCenter('a');
  expect(fetcher).toHaveBeenCalledTimes(3);
  invalidateApprovalCenter();
  await getApprovalCenter('a');
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('does not cache rejected list reads and protects forced refresh generations', async () => {
  let finishOld!: (value: unknown) => void;
  const fetcher = vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 403, headers: new Headers(), json: async () => ({ error: 'forbidden' }) })
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: ['fresh'] }) });
  vi.stubGlobal('fetch', fetcher);
  await expect(getApprovalCenter('a')).rejects.toThrow('forbidden');
  const old = getApprovalCenter('a');
  const fresh = await getApprovalCenter('a', { forceRefresh: true });
  finishOld({ ok: true, json: async () => ({ data: ['stale'] }) });
  await expect(old).resolves.toEqual({ data: ['fresh'] });
  await expect(getApprovalCenter('a')).resolves.toEqual({ data: ['fresh'] });
  expect(fresh).toEqual({ data: ['fresh'] });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
