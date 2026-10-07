// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { RegistrationReviewPanel } from './RegistrationReviewPanel';

afterEach(() => cleanup());
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'registrationRequests').mockResolvedValue({
    data: [{
      id: 'newest-request',
      submittedName: 'คำขอล่าสุด',
      email: 'newest@example.test',
      status: 'PENDING',
      createdAt: '2026-10-07T01:00:00.000Z'
    }],
    meta: { total: 30, totalPages: 2 }
  } as never);
  vi.spyOn(api, 'registrationRequest').mockResolvedValue({
    data: {
      id: 'focused-request',
      submittedName: 'คำขอที่ต้องการตรวจ',
      email: 'focused@example.test',
      status: 'MATCHED',
      matchedEmployeeId: 'employee-1',
      matchedEmployee: { id: 'employee-1', employeeCode: 'E001', displayName: 'พนักงานตัวอย่าง' },
      createdAt: '2026-10-01T01:00:00.000Z'
    }
  } as never);
  vi.spyOn(api, 'registrationCandidates').mockResolvedValue({ data: [], meta: { employeeMatchState: 'EMPLOYEE_NOT_FOUND' } } as never);
});

describe('RegistrationReviewPanel approval inbox focus', () => {
  it('loads and selects the exact registration request passed by Approval Center', async () => {
    const onInitialRequestHandled = vi.fn();
    render(<RegistrationReviewPanel
      token="test-token"
      role="SUPERVISOR"
      refreshSignal={0}
      initialRequestId="focused-request"
      onInitialRequestHandled={onInitialRequestHandled}
      onChanged={vi.fn()}
      onOpenEmployeeMaster={vi.fn()}
    />);

    const focusedRow = await screen.findByRole('button', { name: /คำขอที่ต้องการตรวจ/ });
    await waitFor(() => expect(focusedRow.getAttribute('aria-pressed')).toBe('true'));
    expect(api.registrationRequest).toHaveBeenCalledWith('test-token', 'focused-request');
    expect(onInitialRequestHandled).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('focused@example.test').length).toBeGreaterThan(0);
  });
});
