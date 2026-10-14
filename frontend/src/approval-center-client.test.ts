// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { getApprovalCenterSummary, invalidateApprovalCenterSummary } from './approval-center-client';
afterEach(() => { invalidateApprovalCenterSummary(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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
