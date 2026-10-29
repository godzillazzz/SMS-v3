// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationCenterPanel } from './NotificationCenterPanel';

const client = vi.hoisted(() => ({ get: vi.fn(), setEmail: vi.fn(), testEmail: vi.fn() }));
vi.mock('./notification-center-client', () => ({ notificationCenterClient: client }));
const data = { events: [{ eventType: 'LEAVE_CREATED', label: 'New leave request', recipientPolicy: 'EMPLOYEE', emailEnabled: true, mandatory: false }], providers: { email: { enabled: true, configured: true }, line: { status: 'NOT_ENABLED' } } };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('Notification Center load errors', () => {
  it('clears the previous load error when retry succeeds', async () => {
    client.get.mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce(data);
    render(<NotificationCenterPanel token="token" />);
    fireEvent.click(await screen.findByRole('button', { name: 'ลองโหลดใหม่' }));
    await screen.findByText('New leave request');
    expect(screen.queryByText(/network unavailable/)).toBeNull();
  });
  it('does not replace a failed post-save refresh with a success message', async () => {
    client.get.mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('refresh unavailable'));
    client.setEmail.mockResolvedValueOnce({});
    render(<NotificationCenterPanel token="token" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /New leave request/ }));
    await waitFor(() => expect(screen.queryByText(/refresh unavailable/)).not.toBeNull());
    expect(screen.queryByText('บันทึกการตั้งค่า Email แล้ว')).toBeNull();
  });
});
