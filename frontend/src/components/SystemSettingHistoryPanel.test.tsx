// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatThaiDateTime } from '../thai-date-time';
import { SystemSettingHistoryPanel } from './SystemSettingHistoryPanel';
import { systemSettingHistoryClient } from './system-setting-history-client';

vi.mock('./system-setting-history-client', () => ({
  systemSettingHistoryClient: {
    get: vi.fn(),
    restore: vi.fn(),
  },
}));

vi.mock('./useActionDialog', () => ({
  useActionDialog: () => ({ dialog: null, prompt: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SystemSettingHistoryPanel date display', () => {
  it('uses Bangkok midnight and Buddhist year for history timestamps', async () => {
    vi.mocked(systemSettingHistoryClient.get).mockResolvedValue({
      key: 'WORK_DAY_START',
      label: 'เวลาเริ่มงาน',
      restorable: true,
      history: [{
        id: 'history-1',
        key: 'WORK_DAY_START',
        action: 'UPDATE',
        createdAt: '2026-12-31T17:00:00.000Z',
        actor: { id: 'user-1', displayName: 'ผู้ดูแลระบบ', email: 'admin@example.test' },
        beforeValue: '08:00',
        afterValue: '08:30',
        reason: null,
        event: null,
        restorable: true,
      }],
    });

    render(<SystemSettingHistoryPanel token="test-token" settings={[{ key: 'WORK_DAY_START', label: 'เวลาเริ่มงาน', registryStatus: 'REGISTERED' }]} onRestored={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'WORK_DAY_START' } });

    await waitFor(() => expect(systemSettingHistoryClient.get).toHaveBeenCalledWith('test-token', 'WORK_DAY_START'));
    const expected = formatThaiDateTime('2026-12-31T17:00:00.000Z');
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    expect(screen.getByText(expected).textContent).toContain('2570');
    expect(screen.getByText(expected).textContent).toContain('1 ม.ค.');
    expect(screen.getByText(expected).textContent).not.toBe(new Date('2026-12-31T17:00:00.000Z').toLocaleString('th-TH'));
  });

  it('localizes known audit event and action labels without changing history values', async () => {
    vi.mocked(systemSettingHistoryClient.get).mockResolvedValue({
      key: 'WORK_DAY_START',
      label: 'เวลาเริ่มงาน',
      restorable: true,
      history: [
        {
          id: 'history-restored', key: 'WORK_DAY_START', action: 'UPDATE', createdAt: '2026-01-01T00:00:00Z',
          actor: { id: 'user-1', displayName: 'ผู้ดูแลระบบ', email: 'admin@example.test' }, beforeValue: '08:00', afterValue: '08:30',
          reason: null, event: 'SYSTEM_SETTING_RESTORED', restorable: true,
        },
        {
          id: 'history-updated', key: 'WORK_DAY_START', action: 'UPDATE', createdAt: '2026-01-02T00:00:00Z',
          actor: { id: 'user-1', displayName: 'ผู้ดูแลระบบ', email: 'admin@example.test' }, beforeValue: '08:30', afterValue: '09:00',
          reason: null, event: null, restorable: true,
        },
      ],
    });

    render(<SystemSettingHistoryPanel token="test-token" settings={[{ key: 'WORK_DAY_START', label: 'เวลาเริ่มงาน', registryStatus: 'REGISTERED' }]} onRestored={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'WORK_DAY_START' } });

    expect(await screen.findByText('ผู้ดูแลระบบ · คืนค่าการตั้งค่าระบบ')).toBeTruthy();
    expect(screen.getByText('ผู้ดูแลระบบ · แก้ไขรายการ')).toBeTruthy();
    expect(screen.queryByText('ผู้ดูแลระบบ · SYSTEM_SETTING_RESTORED')).toBeNull();
    expect(screen.queryByText('ผู้ดูแลระบบ · UPDATE')).toBeNull();
  });
});
