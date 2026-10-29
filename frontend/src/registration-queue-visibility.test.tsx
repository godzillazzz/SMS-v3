// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrationReviewPanel } from './pages/access-management/RegistrationReviewPanel';
import { api } from './api';

vi.mock('./api', () => ({ api: { registrationRequests: vi.fn(), registrationCandidates: vi.fn(), registrationRequest: vi.fn() } }));

const props = { hideWhenEmpty: true, token: 'test', role: 'ADMIN', refreshSignal: 0, onChanged: vi.fn(), onOpenEmployeeMaster: vi.fn() };
const empty = { data: [], meta: { total: 0, totalPages: 1 } };
const row = { id: '1', submittedName: 'Test Applicant', email: 'test@example.com', status: 'APPROVED' };

describe('empty registration queue', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.registrationRequests).mockResolvedValue(empty as never); });
  afterEach(cleanup);

  it('hides the empty card while keeping an entry point that refreshes and reveals new requests', async () => {
    render(<RegistrationReviewPanel {...props} />);
    await waitFor(() => expect(screen.queryByText('รายการคำขอ')).toBeNull());
    const open = await screen.findByRole('button', { name: 'เปิดคำขอลงทะเบียน' });
    vi.mocked(api.registrationRequests).mockResolvedValueOnce({ data: [row], meta: { total: 1, totalPages: 1 } } as never);
    fireEvent.click(open);
    expect(await screen.findByRole('button', { name: /Test Applicant/ })).toBeTruthy();
    expect(api.registrationRequests).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('สถานะ')).toBeTruthy();
  });
});
