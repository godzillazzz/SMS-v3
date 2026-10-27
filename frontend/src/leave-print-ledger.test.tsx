// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getLeavePrintLedger, LEAVE_PRINT_LEDGER_READY_EVENT, LeavePrintLedgerPanel, type LeavePrintLedger } from './leave-print-ledger';

const ledgerListeners: Array<() => void> = [];

afterEach(() => {
  cleanup();
  ledgerListeners.splice(0).forEach((removeListener) => removeListener());
  vi.unstubAllGlobals();
});

const leave = {
  id: 'c0000000-0000-4000-8000-000000000001',
  employeeId: 'b0000000-0000-4000-8000-000000000001',
  status: 'APPROVED',
  leaveType: 'VACATION',
  leaveTypeNameSnapshot: 'ลาพักร้อน',
  leaveQuotaBucketSnapshot: 'VACATION',
  startDate: '2026-01-10T00:00:00.000Z',
  endDate: '2026-01-11T00:00:00.000Z',
  dayCount: 2
};

function mockFetch(response: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue({ data: response })
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function observeLedgerReady(onReady: (detail: { row: typeof leave; ledger: LeavePrintLedger }) => void) {
  const listener = (event: Event) => onReady((event as CustomEvent<{ row: typeof leave; ledger: LeavePrintLedger }>).detail);
  window.addEventListener(LEAVE_PRINT_LEDGER_READY_EVENT, listener);
  ledgerListeners.push(() => window.removeEventListener(LEAVE_PRINT_LEDGER_READY_EVENT, listener));
}

describe('leave print ledger client contract', () => {
  test('requests only the authenticated request-specific endpoint, with no employee or year selector', async () => {
    const fetchMock = mockFetch({ available: false });
    await getLeavePrintLedger('synthetic-token', leave.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/v1/leave-requests/${leave.id}/print-ledger`);
    expect(url).not.toContain('employeeId');
    expect(url).not.toContain('year=');
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer synthetic-token');
  });
});

describe('leave print ledger panel', () => {
  test('does not render or request ledger data for VIEWER', () => {
    const onPrint = vi.fn();
    const fetchMock = mockFetch({ available: true, previouslyApprovedDays: 4 });
    const { container } = render(<LeavePrintLedgerPanel role="VIEWER" row={leave} token="synthetic-token" onPrint={onPrint} />);
    expect(container.textContent).not.toMatch(/คงเหลือ|ใช้ไป|ก่อนลา|หลังลา/);
    expect(container.querySelector('button')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onPrint).not.toHaveBeenCalled();
  });

  test.each(['ADMIN', 'MANAGER', 'SUPERVISOR'])('%s prints only after an available calendar-day ledger is loaded', async (role) => {
    const ledger: LeavePrintLedger = { available: true, bucket: 'VACATION', entitlementDays: 6, previouslyApprovedDays: 2, requestDays: 2, remainingBeforeDays: 4, remainingAfterDays: 2, unit: 'วัน (ปฏิทิน)' };
    const fetchMock = mockFetch(ledger);
    const onPrint = vi.fn();
    const onLedgerReady = vi.fn();
    observeLedgerReady(onLedgerReady);
    render(<LeavePrintLedgerPanel role={role} row={leave} token="synthetic-token" onPrint={onPrint} />);
    fireEvent.click(screen.getByRole('button', { name: 'พิมพ์ A4' }));
    await waitFor(() => expect(onPrint).toHaveBeenCalledTimes(1));
    expect(onPrint).toHaveBeenCalledWith(leave);
    expect(onLedgerReady).toHaveBeenCalledWith({ row: leave, ledger });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/leave-requests/${leave.id}/print-ledger`);
  });

  test.each([
    ['unavailable ledger', { available: false, reason: 'QUOTA_MISSING' }],
    ['non-finite balance', { available: true, bucket: 'VACATION', entitlementDays: Number.POSITIVE_INFINITY, previouslyApprovedDays: 2, requestDays: 2, remainingBeforeDays: 4, remainingAfterDays: 2, unit: 'วัน (ปฏิทิน)' }],
    ['wrong unit', { available: true, bucket: 'VACATION', entitlementDays: 6, previouslyApprovedDays: 2, requestDays: 2, remainingBeforeDays: 4, remainingAfterDays: 2, unit: 'วัน' }]
  ])('%s never prints or exposes balance numbers', async (_case, response) => {
    mockFetch(response);
    const onPrint = vi.fn();
    const onLedgerReady = vi.fn();
    observeLedgerReady(onLedgerReady);
    render(<LeavePrintLedgerPanel role="ADMIN" row={leave} token="synthetic-token" onPrint={onPrint} />);
    fireEvent.click(screen.getByRole('button', { name: 'พิมพ์ A4' }));
    await screen.findByText(/ไม่สามารถแสดงยอดคงเหลือ/);
    expect(screen.queryByText(/คงเหลือก่อนลา|คงเหลือหลังลา|ใช้ไปแล้ว/)).toBeNull();
    expect(onPrint).not.toHaveBeenCalled();
    expect(onLedgerReady).not.toHaveBeenCalled();
  });

  test('request errors never print or expose balance numbers', async () => {
    mockFetch({ error: 'unavailable' }, 500);
    const onPrint = vi.fn();
    const onLedgerReady = vi.fn();
    observeLedgerReady(onLedgerReady);
    render(<LeavePrintLedgerPanel role="ADMIN" row={leave} token="synthetic-token" onPrint={onPrint} />);
    fireEvent.click(screen.getByRole('button', { name: 'พิมพ์ A4' }));
    await screen.findByText(/ไม่สามารถแสดงยอดคงเหลือ/);
    expect(screen.queryByText(/คงเหลือก่อนลา|คงเหลือหลังลา|ใช้ไปแล้ว/)).toBeNull();
    expect(onPrint).not.toHaveBeenCalled();
    expect(onLedgerReady).not.toHaveBeenCalled();
  });

  test('stale balances are never shown while a new row is selected', async () => {
    let resolveRequest!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => { resolveRequest = resolve; });
    const fetchMock = vi.fn().mockReturnValue(pendingResponse);
    vi.stubGlobal('fetch', fetchMock);
    const onPrint = vi.fn();
    const onLedgerReady = vi.fn();
    observeLedgerReady(onLedgerReady);
    const { rerender, container } = render(<LeavePrintLedgerPanel role="ADMIN" row={leave} token="synthetic-token" onPrint={onPrint} />);
    fireEvent.click(screen.getByRole('button', { name: 'พิมพ์ A4' }));
    rerender(<LeavePrintLedgerPanel role="ADMIN" row={{ ...leave, id: 'c0000000-0000-4000-8000-000000000002' }} token="synthetic-token" onPrint={vi.fn()} />);
    expect(container.textContent).not.toMatch(/คงเหลือก่อนลา|คงเหลือหลังลา|ใช้ไปแล้ว/);
    resolveRequest(new Response(JSON.stringify({ data: { available: true, bucket: 'VACATION', entitlementDays: 6, previouslyApprovedDays: 1, requestDays: 2, remainingBeforeDays: 5, remainingAfterDays: 3, unit: 'วัน (ปฏิทิน)' } }), { status: 200 }));
    await waitFor(() => expect(onPrint).not.toHaveBeenCalled());
    expect(container.textContent).not.toMatch(/คงเหลือก่อนลา|คงเหลือหลังลา|ใช้ไปแล้ว/);
    expect(onLedgerReady).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
