// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../attendance-auth-request', () => ({ attendanceAuthenticatedRequest: request }));

import { attendanceSupervisorMonthPrint } from './attendance-supervisor-client';

describe('attendanceSupervisorMonthPrint', () => {
  beforeEach(() => {
    request.mockReset();
    request.mockResolvedValue(new Response(JSON.stringify({ data: { employees: [] } }), { status: 200 }));
  });

  it('calls the dedicated read-only selected-date endpoint', async () => {
    await attendanceSupervisorMonthPrint('token', '2026-08-29');
    expect(request).toHaveBeenCalledWith('/attendance/supervisor/month-print?selectedDate=2026-08-29', 'token', expect.objectContaining({ method: 'GET' }));
  });
});
